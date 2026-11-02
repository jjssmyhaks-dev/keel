import type { Connector } from "../../connectors";
import { actionFactory, docsBase } from "./shared";

const slug = "shopify";
const action = actionFactory(slug);
const graphql = "/admin/api/2026-01/graphql.json";

const shopify: Connector = {
  slug,
  name: "Shopify",
  category: "Commerce",
  description: "Read products, orders and customers, and run named GraphQL mutations on one Shopify shop.",
  color: "#7AB55C",
  mark: "SH",
  docsUrl: `${docsBase}/${slug}`,
  authMethods: [{ type: "oauth", label: "Shopify OAuth per shop" }],
  defaultAuth: "oauth",
  hosts: ["*.myshopify.com"],
  allowAnyPublicHost: true,
  baseUrlField: "shop_domain",
  injection: { type: "header", name: "X-Shopify-Access-Token", field: "access_token" },
  credentialFields: [
    {
      key: "shop_domain",
      label: "Shop domain",
      required: true,
      placeholder: "acme.myshopify.com",
      help: "Validated as *.myshopify.com. The connector refuses other hosts.",
    },
    {
      key: "access_token",
      label: "Admin API access token",
      secret: true,
      required: true,
      placeholder: "shpat_…",
    },
  ],
  scopes: [
    { value: "read_products", label: "Read products" },
    { value: "write_products", label: "Create and update products", optional: true },
    { value: "read_orders", label: "Read orders" },
    { value: "write_orders", label: "Fulfil and cancel orders", optional: true },
    { value: "read_customers", label: "Read customers", optional: true },
    { value: "write_inventory", label: "Adjust inventory", optional: true },
  ],
  resourceLabel: "Shop, order or product",
  resourcePlaceholder: "gid://shopify/Order/1234",
  status: "beta",
  version: "0.1.0",
  redactedFields: ["access_token", "authorization", "email", "phone"],
  actions: [
    action("list_products", "List products", "POST", graphql, "read", "List products with cursor paging.", {
      fields: [{ key: "first", label: "Page size", placeholder: "20" }],
      sample: { data: { products: { nodes: [{ id: "gid://shopify/Product/1", title: "Agent tee" }] } } },
    }),
    action("get_product", "Get product", "POST", graphql, "read", "Read one product.", {
      resourceLabel: "Product",
      sample: { data: { product: { id: "gid://shopify/Product/1", title: "Agent tee" } } },
    }),
    action("create_product", "Create product", "POST", graphql, "write", "Create a product.", {
      fields: [{ key: "title", label: "Title", placeholder: "Agent hoodie", required: true }],
      sample: { data: { productCreate: { product: { id: "gid://shopify/Product/2", title: "Agent hoodie" } } } },
    }),
    action("update_product", "Update product", "POST", graphql, "write", "Update a product.", {
      resourceLabel: "Product",
      fields: [{ key: "title", label: "Title", placeholder: "Agent hoodie v2" }],
      sample: { data: { productUpdate: { product: { id: "gid://shopify/Product/2" } } } },
    }),
    action("list_orders", "List orders", "POST", graphql, "read", "List orders with cursor paging.", {
      sample: { data: { orders: { nodes: [{ id: "gid://shopify/Order/1234", name: "#1001" }] } } },
    }),
    action("get_order", "Get order", "POST", graphql, "read", "Read one order.", {
      resourceLabel: "Order",
      sample: { data: { order: { id: "gid://shopify/Order/1234", name: "#1001" } } },
    }),
    action("create_fulfillment", "Create fulfillment", "POST", graphql, "write", "Fulfil an order.", {
      resourceLabel: "Order",
      fields: [{ key: "orderId", label: "Order ID", placeholder: "gid://shopify/Order/1234", required: true }],
      sample: { data: { fulfillmentCreate: { fulfillment: { status: "SUCCESS" } } } },
    }),
    action("cancel_order", "Cancel order", "POST", graphql, "destructive", "Cancel an order.", {
      resourceLabel: "Order",
      fields: [{ key: "orderId", label: "Order ID", placeholder: "gid://shopify/Order/1234", required: true }],
      sample: { data: { orderCancel: { order: { id: "gid://shopify/Order/1234", cancelledAt: "2026-11-02T09:00:00Z" } } } },
    }),
    action("refund_order", "Refund order", "POST", graphql, "financial", "Refund an order. Approval required by default.", {
      resourceLabel: "Order",
      fields: [{ key: "orderId", label: "Order ID", placeholder: "gid://shopify/Order/1234", required: true }],
      sample: { data: { refundCreate: { refund: { id: "gid://shopify/Refund/1" } } } },
    }),
    action("list_customers", "List customers", "POST", graphql, "read", "List customers. Personal fields are redacted by default.", {
      sample: { data: { customers: { nodes: [{ id: "gid://shopify/Customer/1", email: "[redacted]" }] } } },
    }),
    action("get_customer", "Get customer", "POST", graphql, "read", "Read one customer with redaction.", {
      resourceLabel: "Customer",
      sample: { data: { customer: { id: "gid://shopify/Customer/1", email: "[redacted]" } } },
    }),
    action("adjust_inventory", "Adjust inventory", "POST", graphql, "write", "Adjust inventory at a location.", {
      fields: [{ key: "inventoryItemId", label: "Inventory item ID", required: true }, { key: "delta", label: "Delta", placeholder: "-1" }],
      sample: { data: { inventoryAdjustQuantities: { userErrors: [] } } },
    }),
    action("list_discounts", "List discounts", "POST", graphql, "read", "List discount codes.", {
      sample: { data: { discountNodes: { nodes: [{ id: "gid://shopify/DiscountCodeNode/1" }] } } },
    }),
    action("create_discount_code", "Create discount code", "POST", graphql, "write", "Create a discount code.", {
      fields: [{ key: "code", label: "Code", placeholder: "AGENT10", required: true }],
      sample: { data: { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/2" } } } },
    }),
  ],
};

export default shopify;
