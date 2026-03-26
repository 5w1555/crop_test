import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  // AppProvider needs the API key to initialize AppBridge in the iframe
  return { apiKey: process.env.SHOPIFY_API_KEY };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    // isEmbeddedApp tells AppBridge this runs inside the Shopify Admin iframe
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/crop">Smart Crop</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Required: lets Shopify set correct CSP/frame headers for embedded apps
export const headers = (headersArgs) => boundary.headers(headersArgs);

// Required: boundary.error handles Shopify-specific auth errors gracefully
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}