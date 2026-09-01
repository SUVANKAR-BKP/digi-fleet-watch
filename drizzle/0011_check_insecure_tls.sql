-- Digi Fleet Watch: allow HTTP checks against untrusted certificates.
--
-- Node's fetch refuses any certificate it cannot verify, which makes it
-- impossible to monitor the two cases that come up constantly on an internal
-- fleet: a service behind a private CA, and HTTPS served on a bare IP address
-- (where the certificate can never match the "hostname").
--
-- The TLS check type already connects with rejectUnauthorized:false, because
-- its whole job is to report on certificates. This gives HTTP checks the same
-- escape hatch, but as an explicit per-check opt-in rather than a default --
-- a check that ignores certificates cannot also warn you about them.

ALTER TABLE "checks"
	ADD COLUMN IF NOT EXISTS "insecure_tls" boolean NOT NULL DEFAULT false;
