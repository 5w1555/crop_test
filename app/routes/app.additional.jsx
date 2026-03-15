import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import CropPage from "../components/crop/CropPage.jsx";

export const loader = async (loaderArgs) => {
  const { loader } = await import("../services/additionalRoute.server.js");
  return loader(loaderArgs);
};

export const action = async (actionArgs) => {
  const { action } = await import("../services/additionalRoute.server.js");
  return action(actionArgs);
};

export default function AdditionalRoute() {
  return <CropPage />;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
