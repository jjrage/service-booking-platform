import type { Metadata } from "next";
import { Suspense } from "react";

import { requireClient } from "@/server/auth/viewer";
import { myProfile } from "@/server/portal";
import { Card, CardHeader } from "@/ui/card";
import { Skeleton } from "@/ui/feedback";

import { ContactForm, HomeNotesForm } from "./forms";

export const metadata: Metadata = { title: "Home & profile" };

export default function ProfilePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Profile />
    </Suspense>
  );
}

async function Profile() {
  const { client } = await requireClient("/portal/profile");
  const { profile, homes } = await myProfile(client);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Home &amp; profile</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card className="self-start">
          <CardHeader title="Contact" description={profile.email} />
          <ContactForm fullName={profile.full_name} phone={profile.phone ?? ""} />
        </Card>
        <div className="space-y-6">
          {homes.map((home) => (
            <Card key={home.id}>
              <CardHeader
                title={home.address_line1}
                description={`${home.city}, ${home.state} ${home.zip} · ${home.bedrooms} bed · ${home.full_baths} bath${
                  home.half_baths ? ` · ${home.half_baths} half bath` : ""
                }${home.sqft ? ` · ${home.sqft.toLocaleString("en-US")} sq ft` : ""}`}
              />
              <HomeNotesForm
                propertyId={home.id}
                hasPets={home.has_pets}
                petNotes={home.pet_notes ?? ""}
                accessNotes={home.access_notes ?? ""}
                parkingNotes={home.parking_notes ?? ""}
              />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
