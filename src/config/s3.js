// S3 client instance + bucket name, read from env. AWS credentials are blank
// in this environment (open item — see NOTES); `isConfigured` lets
// upload.service.js fail gracefully instead of crashing the process.
const { S3Client } = require('@aws-sdk/client-s3');
const config = require('./env');

const isConfigured = Boolean(
  config.aws.accessKeyId && config.aws.secretAccessKey && config.aws.bucket
);

const s3Client = isConfigured
  ? new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    })
  : null;

module.exports = {
  s3Client,
  bucket: config.aws.bucket,
  region: config.aws.region,
  isConfigured,
};
