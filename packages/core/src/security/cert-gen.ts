/**
 * Development certificate generation utility.
 *
 * Uses the system `openssl` CLI to generate a self-signed CA, server
 * certificate, and optionally client certificates for mTLS testing.
 *
 * NOT intended for production — production deployments should bring
 * their own properly issued certificates.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Check whether the `openssl` CLI is available on PATH.
 */
export function isOpenSSLAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export interface CertPaths {
  caKey: string;
  caCert: string;
  serverKey: string;
  serverCert: string;
}

/**
 * Generate a self-signed CA and a server certificate signed by that CA.
 *
 * Output files are written to `outputDir`:
 *   ca-key.pem, ca-cert.pem, server-key.pem, server-cert.pem
 */
export function generateDevCerts(outputDir: string): CertPaths {
  mkdirSync(outputDir, { recursive: true });

  const caKey = path.join(outputDir, 'ca-key.pem');
  const caCert = path.join(outputDir, 'ca-cert.pem');
  const serverKey = path.join(outputDir, 'server-key.pem');
  const serverCsr = path.join(outputDir, 'server.csr');
  const serverCert = path.join(outputDir, 'server-cert.pem');

  // Generate CA private key
  execFileSync('openssl', [
    'genrsa', '-out', caKey, '2048',
  ], { stdio: 'pipe' });

  // Generate CA self-signed certificate
  execFileSync('openssl', [
    'req', '-new', '-x509', '-key', caKey,
    '-out', caCert, '-days', '365',
    '-subj', '/CN=Friday Dev CA/O=Friday/C=US',
  ], { stdio: 'pipe' });

  // Generate server private key
  execFileSync('openssl', [
    'genrsa', '-out', serverKey, '2048',
  ], { stdio: 'pipe' });

  // Generate server CSR
  execFileSync('openssl', [
    'req', '-new', '-key', serverKey,
    '-out', serverCsr,
    '-subj', '/CN=localhost/O=Friday/C=US',
  ], { stdio: 'pipe' });

  // Sign server cert with CA
  execFileSync('openssl', [
    'x509', '-req', '-in', serverCsr,
    '-CA', caCert, '-CAkey', caKey,
    '-CAcreateserial', '-out', serverCert,
    '-days', '365',
  ], { stdio: 'pipe' });

  return { caKey, caCert, serverKey, serverCert };
}

export interface ClientCertPaths {
  clientKey: string;
  clientCert: string;
}

/**
 * Generate a client certificate signed by the given CA.
 *
 * @param outputDir  Directory for output files
 * @param cn         Common Name for the client certificate
 * @param caPaths    Paths to the CA key and certificate
 */
export function generateClientCert(
  outputDir: string,
  cn: string,
  caPaths: { caKey: string; caCert: string },
): ClientCertPaths {
  mkdirSync(outputDir, { recursive: true });

  const safeCn = cn.replace(/[^a-zA-Z0-9_-]/g, '_');
  const clientKey = path.join(outputDir, `client-${safeCn}-key.pem`);
  const clientCsr = path.join(outputDir, `client-${safeCn}.csr`);
  const clientCert = path.join(outputDir, `client-${safeCn}-cert.pem`);

  if (!existsSync(caPaths.caKey) || !existsSync(caPaths.caCert)) {
    throw new Error('CA key/cert not found — run generateDevCerts() first');
  }

  execFileSync('openssl', [
    'genrsa', '-out', clientKey, '2048',
  ], { stdio: 'pipe' });

  execFileSync('openssl', [
    'req', '-new', '-key', clientKey,
    '-out', clientCsr,
    '-subj', `/CN=${cn}/O=Friday/C=US`,
  ], { stdio: 'pipe' });

  execFileSync('openssl', [
    'x509', '-req', '-in', clientCsr,
    '-CA', caPaths.caCert, '-CAkey', caPaths.caKey,
    '-CAcreateserial', '-out', clientCert,
    '-days', '365',
  ], { stdio: 'pipe' });

  return { clientKey, clientCert };
}
