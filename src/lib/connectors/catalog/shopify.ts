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
  version: "0.2.0",
  redactedFields: ["access_token", "authorization", "email", "phone"],
  actions: [
    action("list_products", "List products", "POST", graphql, "read", "List products with cursor paging.", {
      fields: [{ key: "first", label: "Page size", placeholder: "20" }],
      graphqlQuery: "query Products($first: Int = 20) { products(first: $first) { nodes { id title handle status } } }",
      sample: { data: { products: { nodes: [{ id: "gid://shopify/Product/1", title: "Agent tee" }] } } },
    }),
    action("get_product", "Get product", "POST", graphql, "read", "Read one product. Pass its GID as the resource.", {
      resourceLabel: "Product",
      graphqlQuery: "query Product($id: ID!) { product(id: $id) { id title handle status } }",
      sample: { data: { product: { id: "gid://shopify/Product/1", title: "Agent tee" } } },
    }),
    action("create_product", "Create product", "POST", graphql, "write", "Create a product from a ProductInput object.", {
      fields: [{ key: "title", label: "Title", placeholder: "Agent hoodie", required: true }],
      graphqlQuery:
        "mutation ProductCreate($input: ProductInput!) { productCreate(input: $input) { product { id title handle } userErrors { field message } } }",
      graphqlWrap: "input",
      sample: { data: { productCreate: { product: { id: "gid://shopify/Product/2", title: "Agent hoodie" } } } },
    }),
    action("update_product", "Update product", "POST", graphql, "write", "Update a product from a ProductInput object, including its id.", {
      resourceLabel: "Product",
      fields: [{ key: "title", label: "Title", placeholder: "Agent hoodie v2" }],
      graphqlQuery:
        "mutation ProductUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id title } userErrors { field message } } }",
      graphqlWrap: "input",
      sample: { data: { productUpdate: { product: { id: "gid://shopify/Product/2" } } } },
    }),
    action("list_orders", "List orders", "POST", graphql, "read", "List orders with cursor paging.", {
      fields: [{ key: "first", label: "Page size", placeholder: "20" }],
      graphqlQuery: "query Orders($first: Int = 20) { orders(first: $first) { nodes { id name displayFulfillmentStatus } } }",
      sample: { data: { orders: { nodes: [{ id: "gid://shopify/Order/1234", name: "#1001" }] } } },
    }),
    action("get_order", "Get order", "POST", graphql, "read", "Read one order. Pass its GID as the resource.", {
      resourceLabel: "Order",
      graphqlQuery: "query Order($id: ID!) { order(id: $id) { id name displayFulfillmentStatus } }",
      sample: { data: { order: { id: "gid://shopify/Order/1234", name: "#1001" } } },
    }),
    action("cancel_order", "Cancel order", "POST", graphql, "destructive", "Cancel an order, refunding and restocking by default.", {
      resourceLabel: "Order",
      fields: [{ key: "orderId", label: "Order ID", placeholder: "gid://shopify/Order/1234", required: true }],
      graphqlQuery:
        "mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason! = CUSTOMER, $refund: Boolean! = true, $restock: Boolean! = true, $notifyCustomer: Boolean! = true) { orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock, notifyCustomer: $notifyCustomer) { order { id cancelledAt } userErrors { field message } } }",
      sample: { data: { orderCancel: { order: { id: "gid://shopify/Order/1234", cancelledAt: "2026-11-02T09:00:00Z" } } } },
    }),
    action("list_customers", "List customers", "POST", graphql, "read", "List customers. Personal fields are redacted by default.", {
      fields: [{ key: "first", label: "Page size", placeholder: "20" }],
      graphqlQuery: "query Customers($first: Int = 20) { customers(first: $first) { nodes { id email } } }",
      sample: { data: { customers: { nodes: [{ id: "gid://shopify/Customer/1", email: "[redacted]" }] } } },
    }),
    action("get_customer", "Get customer", "POST", graphql, "read", "Read one customer with redaction. Pass its GID as the resource.", {
      resourceLabel: "Customer",
      graphqlQuery: "query Customer($id: ID!) { customer(id: $id) { id email } }",
      sample: { data: { customer: { id: "gid://shopify/Customer/1", email: "[redacted]" } } },
    }),
    action("adjust_inventory", "Adjust inventory", "POST", graphql, "write", "Adjust available inventory for an item at a location.", {
      fields: [
        { key: "inventoryItemId", label: "Inventory item ID", required: true },
        { key: "locationId", label: "Location ID", required: true },
        { key: "delta", label: "Delta", placeholder: "-1", required: true },
      ],
      graphqlQuery:
        "mutation Adjust($inventoryItemId: ID!, $locationId: ID!, $delta: Int!) { inventoryAdjustQuantities(input: { reason: \"correction\", name: \"available\", changes: [{ delta: $delta, inventoryItemId: $inventoryItemId, locationId: $locationId }] }) { userErrors { field message } } }",
      sample: { data: { inventoryAdjustQuantities: { userErrors: [] } } },
    }),
    action("list_discounts", "List discounts", "POST", graphql, "read", "List discount codes.", {
      fields: [{ key: "first", label: "Page size", placeholder: "20" }],
      graphqlQuery: "query Discounts($first: Int = 20) { discountNodes(first: $first) { nodes { id } } }",
      sample: { data: { discountNodes: { nodes: [{ id: "gid://shopify/DiscountCodeNode/1" }] } } },
    }),
  ],
};

export default shopify;
