import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "snowflake";
const action = actionFactory(slug);

const snowflake: Connector = {
  slug,
  name: "Snowflake",
  category: "AI & data",
  description: "Run guarded SQL against a fixed warehouse, role and schema with key-pair authentication.",
  color: "#29B5E8",
  mark: "SN",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [
    { type: "basic", label: "Key-pair JWT" },
    { type: "oauth", label: "Snowflake OAuth" },
  ],
  defaultAuth: "basic",
  hosts: ["*.snowflakecomputing.com"],
  hostTemplate: "{account_identifier}.snowflakecomputing.com",
  allowAnyPublicHost: true,
  authStrategy: "snowflake-jwt",
  bodyParams: [
    { name: "warehouse", field: "warehouse" },
    { name: "role", field: "role" },
    { name: "database", field: "database" },
    { name: "schema", field: "schema" },
  ],
  injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "private_key" },
  credentialFields: [
    { key: "account_identifier", label: "Account identifier", required: true, placeholder: "acme-ap-south-1" },
    { key: "user", label: "Service user", required: true, placeholder: "KEEL_AGENT" },
    {
      key: "private_key",
      label: "Private key (PEM)",
      secret: true,
      required: true,
      multiline: true,
      help: "Used only to sign a short-lived JWT. Encrypted at rest and never returned.",
    },
    { key: "passphrase", label: "Key passphrase", secret: true, help: "Only if the private key is encrypted." },
    { key: "warehouse", label: "Warehouse", required: true, placeholder: "AGENT_WH" },
    { key: "role", label: "Role", required: true, placeholder: "AGENT_READONLY" },
    { key: "database", label: "Database", required: true, placeholder: "ANALYTICS" },
    { key: "schema", label: "Schema", required: true, placeholder: "PUBLIC" },
  ],
  scopes: [
    { value: "sql:read", label: "Run SELECT, SHOW, DESCRIBE and EXPLAIN" },
    { value: "sql:write", label: "Run INSERT, UPDATE and MERGE", optional: true },
    { value: "sql:admin", label: "Run DDL and grants", optional: true },
  ],
  resourceLabel: "Database, schema or table",
  resourcePlaceholder: "ANALYTICS.PUBLIC.EVENTS",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["private_key", "passphrase", "authorization"],
  actions: [
    action("run_query", "Run query", "POST", "/api/v2/statements", "read", "Run one SELECT, SHOW, DESCRIBE or EXPLAIN. Row limits and a timeout are injected.", {
      fields: [{ key: "statement", label: "SQL", placeholder: "select * from events limit 10", required: true }],
      sample: { statementHandle: "01a2b3", resultSetMetaData: { rowType: [{ name: "ID" }] }, data: [[1]] },
    }),
    action("get_statement_result", "Get statement result", "GET", "/api/v2/statements/{handle}", "read", "Read partitions of a long-running query result.", {
      resourceLabel: "Statement",
      sample: { statementHandle: "01a2b3", data: [[1]], partitions: 1 },
    }),
    action("cancel_statement", "Cancel statement", "POST", "/api/v2/statements/{handle}/cancel", "write", "Cancel a running statement.", {
      resourceLabel: "Statement",
      sample: { statementHandle: "01a2b3", status: "CANCELLED" },
    }),
    action("run_statement_write", "Run write statement", "POST", "/api/v2/statements", "write", "Run INSERT, UPDATE or MERGE. Disabled unless the customer enables it.", {
      fields: [{ key: "statement", label: "SQL", placeholder: "insert into events values (2)", required: true }],
      sample: { statementHandle: "01a2b4", data: [["rows_inserted", 1]] },
    }),
    action("run_statement_admin", "Run admin statement", "POST", "/api/v2/statements", "admin", "Run DDL or grants. Disabled by default.", {
      fields: [{ key: "statement", label: "SQL", placeholder: "create table test (id int)", required: true }],
      sample: { statementHandle: "01a2b5", data: [["status", "created"]] },
    }),
    action("list_databases", "List databases", "POST", "/api/v2/statements", "read", "List databases with SHOW DATABASES.", {
      sample: { statementHandle: "01a2b6", data: [["ANALYTICS"]] },
    }),
    action("list_schemas", "List schemas", "POST", "/api/v2/statements", "read", "List schemas with SHOW SCHEMAS.", {
      sample: { statementHandle: "01a2b7", data: [["PUBLIC"]] },
    }),
    action("list_tables", "List tables", "POST", "/api/v2/statements", "read", "List tables with SHOW TABLES.", {
      sample: { statementHandle: "01a2b8", data: [["EVENTS"]] },
    }),
    action("describe_table", "Describe table", "POST", "/api/v2/statements", "read", "Describe a table's columns.", {
      resourceLabel: "Table",
      fields: [{ key: "table", label: "Table", placeholder: "EVENTS", required: true }],
      sample: { statementHandle: "01a2b9", data: [["ID", "NUMBER"]] },
    }),
  ],
};

export default snowflake;
