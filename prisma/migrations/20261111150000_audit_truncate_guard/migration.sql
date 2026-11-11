-- Extend WORM retention to TRUNCATE: a restore or retention job must opt in
-- per transaction, exactly like UPDATE and DELETE.
CREATE TRIGGER audit_events_truncate_immutable
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION authab_audit_events_immutable();
