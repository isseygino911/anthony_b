const ApiError = require('../../utils/apiError');

// Safe arithmetic expression parser/evaluator for admin-authored pricing
// formulas. Deliberately hand-rolled: NEVER eval() or new Function() on admin
// input — a formula reaches this module straight from a DB column an admin can
// edit, so the only safe evaluator is one that cannot express anything beyond
// arithmetic.
//
// Grammar (precedence low -> high):
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := '-' unary | primary
//   primary := number | ident | ident '(' args ')' | '(' expr ')'

const MAX_LENGTH = 500;

// Arity is checked at parse time so a bad formula fails on save, not on a
// customer's price request. min/max are variadic (at least one argument).
const FUNCTIONS = {
  ceil: { arity: 1, apply: (a) => Math.ceil(a) },
  floor: { arity: 1, apply: (a) => Math.floor(a) },
  round: { arity: 1, apply: (a) => Math.round(a) },
  abs: { arity: 1, apply: (a) => Math.abs(a) },
  min: { arity: null, apply: (...a) => Math.min(...a) },
  max: { arity: null, apply: (...a) => Math.max(...a) },
};

function tokenize(source) {
  if (typeof source !== 'string') throw ApiError.badRequest('Formula must be a string');
  if (source.length > MAX_LENGTH) {
    throw ApiError.badRequest(`Formula is too long (max ${MAX_LENGTH} characters)`);
  }

  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];

    if (/\s/.test(char)) {
      i += 1;
    } else if (/[0-9.]/.test(char)) {
      const start = i;
      while (i < source.length && /[0-9.]/.test(source[i])) i += 1;
      const raw = source.slice(start, i);
      // Number() accepts '' and '.' as 0/NaN, so validate the shape explicitly.
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        throw ApiError.badRequest(`Invalid number "${raw}" at position ${start}`);
      }
      tokens.push({ type: 'number', value: Number(raw), position: start });
    } else if (/[A-Za-z_]/.test(char)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i += 1;
      tokens.push({ type: 'ident', value: source.slice(start, i), position: start });
    } else if ('+-*/'.includes(char)) {
      tokens.push({ type: 'op', value: char, position: i });
      i += 1;
    } else if (char === '(' || char === ')') {
      tokens.push({ type: char === '(' ? 'lparen' : 'rparen', value: char, position: i });
      i += 1;
    } else if (char === ',') {
      tokens.push({ type: 'comma', value: char, position: i });
      i += 1;
    } else {
      throw ApiError.badRequest(`Unexpected character "${char}" at position ${i}`);
    }
  }
  return tokens;
}

function parse(source) {
  const tokens = tokenize(source);
  let pos = 0;

  const peek = () => tokens[pos];
  const atEnd = () => pos >= tokens.length;

  function expect(type, description) {
    const token = peek();
    if (!token || token.type !== type) {
      const where = token ? `at position ${token.position}` : 'at end of formula';
      throw ApiError.badRequest(`Expected ${description} ${where}`);
    }
    pos += 1;
    return token;
  }

  function parsePrimary() {
    const token = peek();
    if (!token) throw ApiError.badRequest('Formula ended unexpectedly — expected a value');

    if (token.type === 'number') {
      pos += 1;
      return { type: 'num', value: token.value };
    }

    if (token.type === 'ident') {
      pos += 1;
      if (peek() && peek().type === 'lparen') {
        const fn = FUNCTIONS[token.value];
        if (!fn) throw ApiError.badRequest(`Unknown function "${token.value}"`);
        pos += 1; // consume '('
        const args = [];
        if (peek() && peek().type === 'rparen') {
          pos += 1;
        } else {
          for (;;) {
            args.push(parseExpr());
            if (peek() && peek().type === 'comma') {
              pos += 1;
            } else {
              expect('rparen', `")" to close ${token.value}(`);
              break;
            }
          }
        }
        if (fn.arity === null) {
          if (args.length < 1) {
            throw ApiError.badRequest(`${token.value}() needs at least 1 argument`);
          }
        } else if (args.length !== fn.arity) {
          throw ApiError.badRequest(
            `${token.value}() takes ${fn.arity} argument${fn.arity === 1 ? '' : 's'}, got ${args.length}`
          );
        }
        return { type: 'call', name: token.value, args };
      }
      return { type: 'var', name: token.value, position: token.position };
    }

    if (token.type === 'lparen') {
      pos += 1;
      const inner = parseExpr();
      expect('rparen', '")"');
      return inner;
    }

    throw ApiError.badRequest(`Unexpected "${token.value}" at position ${token.position}`);
  }

  function parseUnary() {
    const token = peek();
    if (token && token.type === 'op' && token.value === '-') {
      pos += 1;
      return { type: 'unary', op: '-', arg: parseUnary() };
    }
    return parsePrimary();
  }

  function parseTerm() {
    let left = parseUnary();
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = peek().value;
      const { position } = peek();
      pos += 1;
      left = { type: 'binary', op, left, right: parseUnary(), position };
    }
    return left;
  }

  function parseExpr() {
    let left = parseTerm();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = peek().value;
      const { position } = peek();
      pos += 1;
      left = { type: 'binary', op, left, right: parseTerm(), position };
    }
    return left;
  }

  if (tokens.length === 0) throw ApiError.badRequest('Formula is empty');
  const ast = parseExpr();
  if (!atEnd()) {
    const token = peek();
    throw ApiError.badRequest(`Unexpected "${token.value}" at position ${token.position}`);
  }
  return ast;
}

// Collects every variable name an AST reads, so callers can check them against
// what a given product actually offers.
function collectVariables(node, found = new Set()) {
  if (node.type === 'var') found.add(node.name);
  else if (node.type === 'unary') collectVariables(node.arg, found);
  else if (node.type === 'binary') {
    collectVariables(node.left, found);
    collectVariables(node.right, found);
  } else if (node.type === 'call') node.args.forEach((arg) => collectVariables(arg, found));
  return found;
}

function evaluateNode(node, scope) {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'var': {
      if (!Object.prototype.hasOwnProperty.call(scope, node.name)) {
        throw ApiError.badRequest(`Unknown variable "${node.name}" in pricing formula`);
      }
      const value = Number(scope[node.name]);
      if (!Number.isFinite(value)) {
        throw ApiError.badRequest(`Variable "${node.name}" is not a number`);
      }
      return value;
    }
    case 'unary':
      return -evaluateNode(node.arg, scope);
    case 'binary': {
      const left = evaluateNode(node.left, scope);
      const right = evaluateNode(node.right, scope);
      if (node.op === '+') return left + right;
      if (node.op === '-') return left - right;
      if (node.op === '*') return left * right;
      // Never return Infinity: a divide-by-zero would otherwise flow into a
      // real charge. Fail loudly instead.
      if (right === 0) throw ApiError.badRequest('Formula error: division by zero');
      return left / right;
    }
    case 'call':
      return FUNCTIONS[node.name].apply(...node.args.map((arg) => evaluateNode(arg, scope)));
    default:
      throw ApiError.badRequest('Malformed pricing formula');
  }
}

function evaluate(source, scope = {}) {
  const ast = typeof source === 'string' ? parse(source) : source;
  const result = evaluateNode(ast, scope);
  if (!Number.isFinite(result)) throw ApiError.badRequest('Formula produced an invalid number');
  return result;
}

// Non-throwing check for save-time validation and live editor feedback.
function validate(source, allowedVars = []) {
  try {
    const ast = parse(source);
    const allowed = new Set(allowedVars);
    const unknown = [...collectVariables(ast)].filter((name) => !allowed.has(name));
    if (unknown.length > 0) {
      return { ok: false, message: `Unknown variable${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}` };
    }
    return { ok: true, ast };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { tokenize, parse, evaluate, validate, collectVariables, FUNCTIONS, MAX_LENGTH };
