import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "twilio";
const action = actionFactory(slug);

const twilio: Connector = {
  slug,
  name: "Twilio",
  category: "Communication",
  description: "Send SMS and WhatsApp, place calls and verify phone numbers with spend caps in place.",
  color: "#F22F46",
  mark: "TW",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [
    { type: "basic", label: "API key SID and secret" },
    { type: "basic", label: "Account auth token" },
  ],
  defaultAuth: "basic",
  hosts: ["api.twilio.com", "lookups.twilio.com", "verify.twilio.com"],
  injection: {
    type: "header",
    name: "Authorization",
    basic: { usernameField: "api_key_sid", passwordField: "api_key_secret" },
  },
  bodyFormat: "form",
  credentialFields: [
    { key: "account_sid", label: "Account SID", required: true, placeholder: "AC…" },
    {
      key: "api_key_sid",
      label: "API key SID",
      required: true,
      placeholder: "SK…",
      help: "Recommended over the account auth token. Used as the Basic auth username.",
    },
    { key: "api_key_secret", label: "API key secret", secret: true, required: true },
  ],
  scopes: [
    { value: "messages", label: "Send and read messages" },
    { value: "calls", label: "Place and read calls", optional: true },
    { value: "lookup", label: "Look up phone numbers", optional: true },
    { value: "verify", label: "Start and check verifications", optional: true },
    { value: "numbers", label: "Buy and release phone numbers", optional: true },
  ],
  resourceLabel: "Phone number",
  resourcePlaceholder: "+14155550100",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["api_key_secret", "auth_token", "authorization", "body"],
  actions: [
    action("send_sms", "Send SMS", "POST", "/2010-04-01/Accounts/{account_sid}/Messages.json", "financial", "Send an SMS. Counts against the per-agent daily send cap.", {
      resourceLabel: "Recipient",
      fields: [
        { key: "To", label: "To", placeholder: "+14155550100", required: true },
        { key: "From", label: "From", placeholder: "+14155550101", required: true },
        { key: "Body", label: "Message", placeholder: "Your code is 123456", required: true },
      ],
      sample: { sid: "SM8f2", status: "queued", to: "+14155550100" },
    }),
    action("send_whatsapp", "Send WhatsApp", "POST", "/2010-04-01/Accounts/{account_sid}/Messages.json", "financial", "Send a WhatsApp message. Numbers are prefixed with whatsapp: by the connector.", {
      resourceLabel: "Recipient",
      fields: [
        { key: "To", label: "To", placeholder: "+14155550100", required: true },
        { key: "From", label: "From", placeholder: "+14155550101", required: true },
        { key: "Body", label: "Message", placeholder: "Order shipped", required: true },
      ],
      sample: { sid: "SM8f3", status: "queued", channel: "whatsapp" },
    }),
    action("list_messages", "List messages", "GET", "/2010-04-01/Accounts/{account_sid}/Messages.json", "read", "List messages on the account.", {
      fields: [{ key: "PageSize", label: "Page size", placeholder: "20" }],
      sample: { messages: [{ sid: "SM8f2", status: "delivered" }] },
    }),
    action("get_message", "Get message", "GET", "/2010-04-01/Accounts/{account_sid}/Messages/{sid}.json", "read", "Read one message.", {
      resourceLabel: "Message",
      sample: { sid: "SM8f2", status: "delivered", body: "[redacted]" },
    }),
    action("make_call", "Make call", "POST", "/2010-04-01/Accounts/{account_sid}/Calls.json", "financial", "Place a voice call.", {
      resourceLabel: "Recipient",
      fields: [
        { key: "To", label: "To", placeholder: "+14155550100", required: true },
        { key: "From", label: "From", placeholder: "+14155550101", required: true },
        { key: "Twiml", label: "TwiML", placeholder: "<Response><Say>Hello</Say></Response>" },
      ],
      sample: { sid: "CA9a1", status: "queued" },
    }),
    action("list_calls", "List calls", "GET", "/2010-04-01/Accounts/{account_sid}/Calls.json", "read", "List calls on the account.", {
      sample: { calls: [{ sid: "CA9a1", status: "completed" }] },
    }),
    action("get_call", "Get call", "GET", "/2010-04-01/Accounts/{account_sid}/Calls/{sid}.json", "read", "Read one call.", {
      resourceLabel: "Call",
      sample: { sid: "CA9a1", status: "completed", duration: "42" },
    }),
    action("lookup_phone_number", "Look up number", "GET", "/v2/PhoneNumbers/{number}", "read", "Look up carrier and line type. Small per-call cost.", {
      host: "lookups.twilio.com",
      resourceLabel: "Phone number",
      sample: { phone_number: "+14155550100", valid: true, line_type_intelligence: { type: "mobile" } },
    }),
    action("start_verification", "Start verification", "POST", "/v2/Services/{service_sid}/Verifications", "write", "Start a Verify code flow.", {
      host: "verify.twilio.com",
      resourceLabel: "Recipient",
      fields: [
        { key: "service_sid", label: "Verify service SID", placeholder: "VA…", required: true },
        { key: "To", label: "To", placeholder: "+14155550100", required: true },
        { key: "Channel", label: "Channel", placeholder: "sms" },
      ],
      sample: { sid: "VE1", status: "pending", channel: "sms" },
    }),
    action("check_verification", "Check verification", "POST", "/v2/Services/{service_sid}/VerificationCheck", "write", "Check a Verify code.", {
      host: "verify.twilio.com",
      resourceLabel: "Recipient",
      fields: [
        { key: "service_sid", label: "Verify service SID", placeholder: "VA…", required: true },
        { key: "To", label: "To", placeholder: "+14155550100", required: true },
        { key: "Code", label: "Code", placeholder: "123456", required: true },
      ],
      sample: { status: "approved", valid: true },
    }),
    action("list_phone_numbers", "List phone numbers", "GET", "/2010-04-01/Accounts/{account_sid}/IncomingPhoneNumbers.json", "read", "List owned phone numbers.", {
      sample: { numbers: [{ phone_number: "+14155550101", friendly_name: "Ops" }] },
    }),
    action("buy_phone_number", "Buy phone number", "POST", "/2010-04-01/Accounts/{account_sid}/IncomingPhoneNumbers.json", "financial", "Buy a number. Disabled unless enabled explicitly.", {
      resourceLabel: "Phone number",
      fields: [{ key: "PhoneNumber", label: "Number", placeholder: "+14155550102", required: true }],
      sample: { sid: "PN1", phone_number: "+14155550102" },
    }),
    action("release_phone_number", "Release phone number", "DELETE", "/2010-04-01/Accounts/{account_sid}/IncomingPhoneNumbers/{sid}.json", "destructive", "Release a number permanently.", {
      resourceLabel: "Phone number",
      sample: { sid: "PN1", released: true },
    }),
  ],
};

export default twilio;
