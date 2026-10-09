"use client";

import { useState, useTransition } from "react";

import { Button } from "@/ui/button";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Alert, Spinner } from "@/ui/feedback";
import { Textarea } from "@/ui/form";
import { browserDb } from "@/ui/supabase-browser";

import { completeJobAction, noAccessAction } from "../../actions";

/** Downscales a phone photo to at most 1600 px as JPEG before upload (a few hundred KB instead of 5 MB). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not read the photo"))),
      "image/jpeg",
      0.8,
    ),
  );
}

export function FinishJob({
  bookingId,
  tenantId,
  checklist,
  canFinish,
}: {
  bookingId: string;
  tenantId: string;
  checklist: string[];
  canFinish: boolean;
}) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<{ path: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const allChecked = checklist.every((item) => done[item]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setMessage(null);
    try {
      for (const file of Array.from(files).slice(0, 12 - photos.length)) {
        const blob = await shrink(file);
        const path = `${tenantId}/${bookingId}/${crypto.randomUUID()}.jpg`;
        // Straight to storage with the cleaner's own session: the bucket's policy allows it only under a job
        // of their crew, within the days around the visit.
        const { error } = await browserDb().storage.from("job-photos").upload(path, blob, {
          contentType: "image/jpeg",
        });
        if (error) throw error;
        setPhotos((current) => [...current, { path, preview: URL.createObjectURL(blob) }]);
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  if (!canFinish) {
    return (
      <Card className="p-5 text-sm text-zinc-600">
        You can mark this job done on the day of the visit.
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Checklist"
        description={`${Object.values(done).filter(Boolean).length} of ${checklist.length} done`}
      />
      <CardBody className="space-y-4">
        <ul className="space-y-1">
          {checklist.map((item) => (
            <li key={item}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                  done[item] ? "bg-emerald-50 text-emerald-900" : "bg-zinc-50 text-zinc-800",
                )}
              >
                <input
                  type="checkbox"
                  className="size-5 accent-brand-700"
                  checked={Boolean(done[item])}
                  onChange={(e) => setDone({ ...done, [item]: e.target.checked })}
                />
                {item}
              </label>
            </li>
          ))}
        </ul>

        <div>
          <p className="text-sm font-medium text-zinc-800">Photos</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {photos.map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of an upload
              <img
                key={photo.path}
                src={photo.preview}
                alt="Uploaded"
                className="aspect-square rounded-lg object-cover"
              />
            ))}
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 text-xs text-zinc-500 hover:border-brand-600">
              {uploading ? <Spinner /> : <span className="text-2xl">+</span>}
              Add
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(e) => upload(e.target.files)}
              />
            </label>
          </div>
        </div>

        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes for the office (optional)"
        />

        {message && <Alert tone={message.ok ? "success" : "danger"}>{message.text}</Alert>}

        <Button
          size="lg"
          className="w-full"
          disabled={pending || uploading}
          onClick={() =>
            startTransition(async () => {
              const result = await completeJobAction({
                bookingId,
                checklist: checklist.map((item) => ({ item, done: Boolean(done[item]) })),
                notes,
                photoPaths: photos.map((p) => p.path),
              });
              setMessage({ ok: result.ok, text: result.message });
            })
          }
        >
          {pending && <Spinner />}
          {allChecked ? "Mark job done" : "Mark done anyway"}
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await noAccessAction(bookingId, notes || "Could not get in");
              setMessage({ ok: result.ok, text: result.message });
            })
          }
        >
          Could not get in
        </Button>
      </CardBody>
    </Card>
  );
}
