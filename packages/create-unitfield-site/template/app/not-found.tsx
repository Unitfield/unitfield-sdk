import Link from "next/link";

export default function NotFound() {
  return (
    <div className="narrow">
      <h1>We could not find that page</h1>
      <p>
        <Link href="/listings">See all homes</Link>
      </p>
    </div>
  );
}
