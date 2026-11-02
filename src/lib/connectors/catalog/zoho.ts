import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "zoho";
const action = actionFactory(slug);

const zoho: Connector = {
  slug,
  name: "Zoho",
  category: "Commerce",
  description: "Work with Zoho CRM modules and Zoho Books invoices, contacts and payments in one region.",
  color: "#E42527",
  mark: "ZH",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "oauth", label: "Zoho OAuth 2.0" }],
  defaultAuth: "oauth",
  hosts: ["*.zohoapis.com", "*.zohoapis.in", "*.zohoapis.eu", "*.zohoapis.jp", "*.zohoapis.com.au"],
  allowAnyPublicHost: true,
  baseUrlField: "api_url",
  injection: { type: "header", name: "Authorization", prefix: "Zoho-oauthtoken ", field: "access_token" },
  credentialFields: [
    {
      key: "api_url",
      label: "API domain",
      required: true,
      placeholder: "https://www.zohoapis.in",
      help: "Pick the data center where the org lives. The connector only calls that region.",
    },
    {
      key: "access_token",
      label: "OAuth access token",
      secret: true,
      required: true,
      placeholder: "1000.…",
      help: "Zoho access tokens last about an hour. Refresh tokens do not expire.",
    },
  ],
  scopes: [
    { value: "ZohoCRM.modules.ALL", label: "Read and change CRM modules" },
    { value: "ZohoCRM.settings.READ", label: "Read CRM fields and layout", optional: true },
    { value: "ZohoBooks.fullaccess.all", label: "Read and change Books data", optional: true },
  ],
  resourceLabel: "Module, record or organization",
  resourcePlaceholder: "Leads",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["access_token", "authorization", "email", "phone", "mobile"],
  actions: [
    action("list_records", "List records", "GET", "/crm/v6/{module}", "read", "List records in a CRM module.", {
      resourceLabel: "Module",
      fields: [{ key: "per_page", label: "Page size", placeholder: "20" }],
      sample: { data: [{ id: "4100", Last_Name: "Rao" }] },
    }),
    action("get_record", "Get record", "GET", "/crm/v6/{module}/{id}", "read", "Read one CRM record.", {
      resourceLabel: "Record",
      sample: { data: [{ id: "4100", Last_Name: "Rao" }] },
    }),
    action("search_records", "Search records", "GET", "/crm/v6/{module}/search", "read", "Search CRM records by criteria.", {
      resourceLabel: "Module",
      fields: [{ key: "criteria", label: "Criteria", placeholder: "(Last_Name:equals:Rao)" }],
      sample: { data: [{ id: "4100", Last_Name: "Rao" }] },
    }),
    action("create_record", "Create record", "POST", "/crm/v6/{module}", "write", "Create a CRM record.", {
      resourceLabel: "Module",
      fields: [{ key: "Last_Name", label: "Last name", placeholder: "Rao", required: true }],
      sample: { data: [{ code: "SUCCESS", details: { id: "4101" } }] },
    }),
    action("update_record", "Update record", "PUT", "/crm/v6/{module}/{id}", "write", "Update a CRM record.", {
      resourceLabel: "Record",
      fields: [{ key: "Last_Name", label: "Last name", placeholder: "Rao" }],
      sample: { data: [{ code: "SUCCESS", details: { id: "4100" } }] },
    }),
    action("delete_record", "Delete record", "DELETE", "/crm/v6/{module}/{id}", "destructive", "Delete a CRM record.", {
      resourceLabel: "Record",
      sample: { data: [{ code: "SUCCESS", details: { id: "4100" } }] },
    }),
    action("list_fields", "List fields", "GET", "/crm/v6/settings/fields", "read", "List fields on a CRM module.", {
      fields: [{ key: "module", label: "Module", placeholder: "Leads" }],
      sample: { fields: [{ api_name: "Last_Name", data_type: "text" }] },
    }),
    action("list_invoices", "List invoices", "GET", "/books/v3/invoices", "read", "List Books invoices.", {
      fields: [{ key: "organization_id", label: "Organization ID", placeholder: "10234695", required: true }],
      sample: { invoices: [{ invoice_id: "963", status: "sent" }] },
    }),
    action("get_invoice", "Get invoice", "GET", "/books/v3/invoices/{id}", "read", "Read one Books invoice.", {
      resourceLabel: "Invoice",
      fields: [{ key: "organization_id", label: "Organization ID", placeholder: "10234695", required: true }],
      sample: { invoice: { invoice_id: "963", status: "sent", total: 4990 } },
    }),
    action("create_invoice", "Create invoice", "POST", "/books/v3/invoices", "write", "Create a Books invoice.", {
      fields: [{ key: "organization_id", label: "Organization ID", placeholder: "10234695", required: true }],
      sample: { invoice: { invoice_id: "964", status: "draft" } },
    }),
    action("email_invoice", "Email invoice", "POST", "/books/v3/invoices/{id}/email", "write", "Email an invoice to the customer.", {
      resourceLabel: "Invoice",
      fields: [{ key: "organization_id", label: "Organization ID", placeholder: "10234695", required: true }],
      sample: { code: 0, message: "Invoice has been sent." },
    }),
    action("list_contacts", "List contacts", "GET", "/books/v3/contacts", "read", "List Books contacts with personal fields redacted.", {
      fields: [{ key: "organization_id", label: "Organization ID", placeholder: "10234695", required: true }],
      sample: { contacts: [{ contact_id: "220", email: "[redacted]" }] },
    }),
    action("create_contact", "Create contact", "POST", "/books/v3/contacts", "write", "Create a Books contact.", {
      fields: [
        { key: "organization_id", label: "Organization ID", placeholder: "10234695", required: true },
        { key: "contact_name", label: "Name", placeholder: "Asha" },
      ],
      sample: { contact: { contact_id: "221", contact_name: "Asha" } },
    }),
    action("record_customer_payment", "Record customer payment", "POST", "/books/v3/customerpayments", "financial", "Record a customer payment.", {
      fields: [
        { key: "organization_id", label: "Organization ID", placeholder: "10234695", required: true },
        { key: "amount", label: "Amount", placeholder: "4990", required: true },
      ],
      sample: { payment: { payment_id: "77", amount: 4990 } },
    }),
    action("list_bills", "List bills", "GET", "/books/v3/bills", "read", "List Books bills.", {
      fields: [{ key: "organization_id", label: "Organization ID", placeholder: "10234695", required: true }],
      sample: { bills: [{ bill_id: "55", status: "open" }] },
    }),
    action("create_bill", "Create bill", "POST", "/books/v3/bills", "write", "Create a Books bill.", {
      fields: [{ key: "organization_id", label: "Organization ID", placeholder: "10234695", required: true }],
      sample: { bill: { bill_id: "56", status: "open" } },
    }),
    action("void_invoice", "Void invoice", "POST", "/books/v3/invoices/{id}/status/void", "destructive", "Void an invoice.", {
      resourceLabel: "Invoice",
      fields: [{ key: "organization_id", label: "Organization ID", placeholder: "10234695", required: true }],
      sample: { invoice: { invoice_id: "963", status: "void" } },
    }),
  ],
};

export default zoho;
