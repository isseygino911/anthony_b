const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, bucket, region, isConfigured } = require('../config/s3');

const EXPIRES_IN_SECONDS = 3600;
const BUCKET_HOST_MARKER = isConfigured ? `${bucket}.s3.${region}.amazonaws.com/` : null;

/**
 * Product/logo image URLs are stored in the DB as permanent-looking S3 URLs
 * (the same shape upload.service.js has always produced — storage format is
 * untouched by this). The bucket itself has Block Public Access enabled, so
 * nothing can load those URLs unsigned. This swaps the stored URL for a
 * short-lived presigned GET URL only at response time, right before it's
 * sent to the client — upload/delete code keeps parsing the stored value
 * exactly as before.
 */
async function signImageUrl(url) {
  if (!url || !BUCKET_HOST_MARKER) return url;
  const key = url.split(BUCKET_HOST_MARKER)[1];
  if (!key) return url; // not one of our S3 objects (e.g. a legacy external URL) — pass through
  try {
    return await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: EXPIRES_IN_SECONDS,
    });
  } catch (err) {
    return url;
  }
}

module.exports = { signImageUrl };
