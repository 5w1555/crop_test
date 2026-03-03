import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <p className={styles.kicker}>Shopify app for product-image workflows</p>
        <h1 className={styles.heading}>SmartCrop automatically prepares cleaner product crops</h1>
        <p className={styles.text}>
          SmartCrop helps Shopify teams upload one or more images, apply consistent cropping,
          and download production-ready results from a single screen.
        </p>

        <div className={styles.grid}>
          <section className={styles.card}>
            <h2>What SmartCrop does</h2>
            <ul>
              <li>Runs content-aware cropping for reliable framing across large batches.</li>
              <li>Supports advanced face-detection crop methods for portrait-heavy catalogs.</li>
              <li>Generates a direct ZIP download so edited assets are ready to reuse.</li>
            </ul>
          </section>

          <section className={styles.card}>
            <h2>Who it is for</h2>
            <ul>
              <li>Merchants and ecommerce teams maintaining consistent product imagery.</li>
              <li>Creative/operations teams who need faster, repeatable image preparation.</li>
              <li>Stores managing high-volume uploads and recurring monthly crop workflows.</li>
            </ul>
          </section>

          <section className={styles.card}>
            <h2>Plans and pricing</h2>
            <ul>
              <li>
                <strong>Free:</strong> €0/month, up to 100 images/month, content-aware cropping
                only.
              </li>
              <li>
                <strong>Pro:</strong> €10/month, up to 2,000 images/month, plus all face-detection
                crop methods.
              </li>
              <li>Upgrade anytime from the in-app Billing page.</li>
            </ul>
          </section>
        </div>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Install or log in with your shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>Example: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Continue to install/login
            </button>
          </Form>
        )}

        <p className={styles.nextStep}>
          Next: open <strong>Crop Images</strong> in <code>/app/additional</code> to upload files,
          run SmartCrop, and download results.
        </p>
      </div>
    </div>
  );
}
