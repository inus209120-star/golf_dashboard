import webpush from "web-push";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/collections";
import type { PushSubscriptionDoc } from "@/types/firestore";

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Missing VAPID env vars (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT)");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

/** Sends one push payload to every stored subscription, pruning any that
 * the push service reports as gone (410/404 - the browser unsubscribed or
 * the device hasn't been seen in a long time) so the list doesn't grow
 * stale forever. */
export async function sendPushToAll(payload: { title: string; body: string; url?: string }): Promise<{ sent: number; pruned: number }> {
  configureWebPush();
  const snap = await adminDb.collection(COLLECTIONS.pushSubscriptions).get();
  let sent = 0;
  let pruned = 0;

  await Promise.all(
    snap.docs.map(async (doc) => {
      const sub = doc.data() as PushSubscriptionDoc;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload)
        );
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await doc.ref.delete();
          pruned++;
        } else {
          console.error("push send failed:", err);
        }
      }
    })
  );

  return { sent, pruned };
}
