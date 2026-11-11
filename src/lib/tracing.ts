import {
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

const TRACER_NAME = "authab";

type SdkHolder = { otelSdk?: { shutdown(): Promise<void> } };
const holder = globalThis as typeof globalThis & SdkHolder;

export function telemetryConfigured() {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

export async function startTelemetry() {
  if (holder.otelSdk || !telemetryConfigured()) return;
  try {
    const [{ NodeSDK }, { OTLPTraceExporter }, { resourceFromAttributes }] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
    ]);
    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": process.env.OTEL_SERVICE_NAME || "authab",
        "service.version": "1.0.0",
        "deployment.environment.name": process.env.NODE_ENV || "development",
      }),
      traceExporter: new OTLPTraceExporter(),
    });
    sdk.start();
    holder.otelSdk = sdk;
  } catch (error) {
    console.error("[authab] OpenTelemetry failed to start", error);
  }
}

export function tracer() {
  return trace.getTracer(TRACER_NAME, "1.0.0");
}

export function traceIdOf(span: Span) {
  const id = span.spanContext().traceId;
  return /^[0-9a-f]{32}$/i.test(id) && !/^0+$/.test(id) ? id.toLowerCase() : undefined;
}

export function traceIdFromTraceparent(value?: string | null) {
  const match = value?.trim().match(/^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i);
  if (!match || /^0+$/.test(match[1])) return undefined;
  return match[1].toLowerCase();
}

export function startSpan(name: string, attributes: Attributes) {
  return tracer().startSpan(name, { attributes });
}

export function endSpanError(span: Span, error: unknown) {
  span.recordException(error instanceof Error ? error : String(error));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : "unknown error",
  });
}

export function endSpanOk(span: Span) {
  span.setStatus({ code: SpanStatusCode.OK });
}

export function recordErrorSpan(
  error: unknown,
  attributes: Attributes,
  traceparent?: string,
): string | undefined {
  if (!telemetryConfigured()) return undefined;
  const parent = traceparent
    ? propagation.extract(context.active(), { traceparent })
    : context.active();
  const span = tracer().startSpan("request.error", { attributes }, parent);
  try {
    endSpanError(span, error);
    return traceIdOf(span);
  } finally {
    span.end();
  }
}

export { SpanStatusCode };
