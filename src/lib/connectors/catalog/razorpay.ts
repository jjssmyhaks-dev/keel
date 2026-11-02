import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "razorpay";
const action = actionFactory(slug);

const razorpay: Connector = {
  slug,
  name: "Razorpay",
  category: "Commerce",
  description: "Create orders and payment links, capture payments and issue refunds with amount controls.",
  color: "#3395FF",
  mark: "RZ",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "basic", label: "Key ID and secret" }],
  defaultAuth: "basic",
  hosts: ["api.razorpay.com"],
  injection: {
    type: "header",
    name: "Authorization",
    basic: { usernameField: "key_id", passwordField: "key_secret" },
  },
  credentialFields: [
    {
      key: "key_id",
      label: "Key ID",
      required: true,
      placeholder: "rzp_test_… or rzp_live_…",
      help: "Test keys must be used in development and live keys in production. Mismatches are rejected.",
    },
    { key: "key_secret", label: "Key secret", secret: true, required: true },
  ],
  scopes: [
    { value: "payments:read", label: "Read payments and refunds" },
    { value: "payments:write", label: "Capture payments and issue refunds", optional: true },
    { value: "orders:write", label: "Create orders, payment links and invoices", optional: true },
    { value: "settlements:read", label: "Read settlements", optional: true },
  ],
  resourceLabel: "Payment, order or customer",
  resourcePlaceholder: "pay_8f2a",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["key_secret", "authorization", "card", "email", "contact"],
  actions: [
    action("list_payments", "List payments", "GET", "/v1/payments", "read", "List payments.", {
      fields: [{ key: "count", label: "Count", placeholder: "20" }],
      mock: { items: [{ id: "pay_8f2a", amount: 49900, currency: "INR", status: "captured" }] },
    }),
    action("get_payment", "Get payment", "GET", "/v1/payments/{id}", "read", "Read one payment.", {
      resourceLabel: "Payment",
      mock: { id: "pay_8f2a", amount: 49900, status: "captured" },
    }),
    action("list_orders", "List orders", "GET", "/v1/orders", "read", "List orders.", {
      mock: { items: [{ id: "order_9c1", amount: 49900, status: "paid" }] },
    }),
    action("get_order", "Get order", "GET", "/v1/orders/{id}", "read", "Read one order.", {
      resourceLabel: "Order",
      mock: { id: "order_9c1", amount: 49900, status: "paid" },
    }),
    action("create_order", "Create order", "POST", "/v1/orders", "write", "Create an order. Amounts are in paise.", {
      fields: [
        { key: "amount", label: "Amount (paise)", placeholder: "49900", required: true },
        { key: "currency", label: "Currency", placeholder: "INR" },
        { key: "receipt", label: "Receipt", placeholder: "run_1842" },
      ],
      mock: { id: "order_9c2", amount: 49900, currency: "INR", status: "created" },
    }),
    action("capture_payment", "Capture payment", "POST", "/v1/payments/{id}/capture", "financial", "Capture an authorized payment.", {
      resourceLabel: "Payment",
      fields: [{ key: "amount", label: "Amount (paise)", placeholder: "49900", required: true }],
      mock: { id: "pay_8f2a", status: "captured" },
    }),
    action("create_refund", "Create refund", "POST", "/v1/payments/{id}/refund", "financial", "Refund a payment. Always needs approval in production unless a refund limit policy is set.", {
      resourceLabel: "Payment",
      fields: [{ key: "amount", label: "Amount (paise)", placeholder: "49900" }],
      mock: { id: "rfnd_1", payment_id: "pay_8f2a", amount: 49900, status: "processed" },
    }),
    action("list_refunds", "List refunds", "GET", "/v1/refunds", "read", "List refunds.", {
      mock: { items: [{ id: "rfnd_1", amount: 49900, status: "processed" }] },
    }),
    action("create_payment_link", "Create payment link", "POST", "/v1/payment_links", "write", "Create a shareable payment link.", {
      fields: [{ key: "amount", label: "Amount (paise)", placeholder: "49900", required: true }],
      mock: { id: "plink_1", short_url: "https://rzp.io/l/acme", status: "created" },
    }),
    action("cancel_payment_link", "Cancel payment link", "POST", "/v1/payment_links/{id}/cancel", "write", "Cancel a payment link.", {
      resourceLabel: "Payment link",
      mock: { id: "plink_1", status: "cancelled" },
    }),
    action("list_customers", "List customers", "GET", "/v1/customers", "read", "List customers with personal fields redacted.", {
      mock: { items: [{ id: "cust_1", email: "[redacted]" }] },
    }),
    action("create_customer", "Create customer", "POST", "/v1/customers", "write", "Create a customer.", {
      fields: [{ key: "name", label: "Name", placeholder: "Asha", required: true }, { key: "email", label: "Email", placeholder: "asha@acme.dev" }],
      mock: { id: "cust_2", name: "Asha" },
    }),
    action("create_invoice", "Create invoice", "POST", "/v1/invoices", "write", "Create an invoice.", {
      fields: [{ key: "customer_id", label: "Customer ID", placeholder: "cust_1" }],
      mock: { id: "inv_1", status: "draft" },
    }),
    action("issue_invoice", "Issue invoice", "POST", "/v1/invoices/{id}/issue", "write", "Issue a draft invoice.", {
      resourceLabel: "Invoice",
      mock: { id: "inv_1", status: "issued" },
    }),
    action("cancel_invoice", "Cancel invoice", "POST", "/v1/invoices/{id}/cancel", "destructive", "Cancel an invoice.", {
      resourceLabel: "Invoice",
      mock: { id: "inv_1", status: "cancelled" },
    }),
    action("list_settlements", "List settlements", "GET", "/v1/settlements", "read", "List settlements.", {
      mock: { items: [{ id: "setl_1", amount: 48200, status: "processed" }] },
    }),
    action("list_subscriptions", "List subscriptions", "GET", "/v1/subscriptions", "read", "List subscriptions.", {
      mock: { items: [{ id: "sub_1", status: "active" }] },
    }),
    action("cancel_subscription", "Cancel subscription", "POST", "/v1/subscriptions/{id}/cancel", "destructive", "Cancel a subscription.", {
      resourceLabel: "Subscription",
      mock: { id: "sub_1", status: "cancelled" },
    }),
  ],
};

export default razorpay;
