import type { Connector } from "../../connectors";
import cursor from "./cursor";
import n8n from "./n8n";
import zapier from "./zapier";
import atlassian from "./atlassian";
import vercel from "./vercel";
import supabase from "./supabase";
import sentry from "./sentry";
import cloudflare from "./cloudflare";
import discord from "./discord";
import microsoft365 from "./microsoft-365";
import twilio from "./twilio";
import resend from "./resend";
import salesforce from "./salesforce";
import airtable from "./airtable";
import shopify from "./shopify";
import razorpay from "./razorpay";
import zoho from "./zoho";
import snowflake from "./snowflake";
import pinecone from "./pinecone";
import huggingface from "./huggingface";
import figma from "./figma";
import dropbox from "./dropbox";

export const EXTRA_CONNECTORS: Connector[] = [
  cursor,
  n8n,
  zapier,
  atlassian,
  vercel,
  supabase,
  sentry,
  cloudflare,
  discord,
  microsoft365,
  twilio,
  resend,
  salesforce,
  airtable,
  shopify,
  razorpay,
  zoho,
  snowflake,
  pinecone,
  huggingface,
  figma,
  dropbox,
];
