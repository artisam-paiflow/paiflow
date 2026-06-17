import { requireSession } from "@/lib/auth";
import Topbar from "@/components/app/topbar";
import AddressBookManager from "@/components/account/address-book";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Address Book · Pink Raft",
};

export default async function AddressBookPage() {
  const user = await requireSession();
  return (
    <>
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-3xl">
        <p className="text-label-sm text-on-surface-variant font-mono">/ ACCOUNT · ADDRESS BOOK</p>
        <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
          Address Book.
        </h1>
        <p className="text-body-md text-on-surface-variant mt-3 max-w-2xl">
          Save Stellar addresses you use often. They appear in the builder so you can pick
          recipients instead of pasting addresses every time.
        </p>

        <AddressBookManager />
      </main>
    </>
  );
}
