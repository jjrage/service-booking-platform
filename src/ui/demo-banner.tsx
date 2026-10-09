/** Shown on every page of a demo business: the company, people and reviews are invented. */
export function DemoBanner() {
  return (
    <div className="bg-zinc-900 px-4 py-1.5 text-center text-xs text-zinc-200">
      <span className="font-semibold text-white">
        Demo — fictional business.
      </span>{" "}
      No real company, clients or payments. Data resets nightly.
    </div>
  );
}
