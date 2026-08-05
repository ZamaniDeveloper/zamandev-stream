# Security Policy

## Supported versions

Security fixes target the latest code on the default branch.

## Reporting a vulnerability

Do not open a public issue for security vulnerabilities. Email **info@zamandev.ir** with reproduction steps, impact, affected browser/server versions, and any suggested remediation.

## Deployment security

Production deployments should use HTTPS, a dedicated TURN service with short-lived credentials, restrictive CORS and origin checks, rate limiting, room access controls, and appropriate logging. Never commit TURN secrets, TLS private keys, or production environment values.