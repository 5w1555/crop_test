import { Link, Outlet } from "react-router";  // ✅ import Link
import { authenticate } from "../shopify.server";
import { NavMenu } from "@shopify/app-bridge-react";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function App() {  // ✅ only ONE default export
  return (
    <>
      <NavMenu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/crop">Smart Crop</Link>
      </NavMenu>
      <Outlet />
    </>
  );
}