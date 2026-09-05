import type { CfQueue } from "../../api/types";
import type { QueueProducerConfig } from "../../types";
import { dnsName } from "./naming";
import { createProvisionedHandler } from "./provisioned";

const path = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/queues`;

export const queuesHandler = createProvisionedHandler<QueueProducerConfig>({
  type: "queues",
  displayName: "Queues",
  extract: (config) => config.queues?.producers ?? [],
  list: async (client, accountId) => {
    const res = await client.list<CfQueue>(path(accountId));
    return res.ok ? { ok: true, data: res.data.map((q) => ({ id: q.queue_id, name: q.queue_name })) } : res;
  },
  create: async (client, accountId, name) => {
    const res = await client.post<CfQueue>(path(accountId), { queue_name: name });
    return res.ok ? { ok: true, data: { id: res.data.queue_id, name: res.data.queue_name } } : res;
  },
  naming: dnsName,
  localId: (entry) => entry.queue_id,
  localName: (entry) => entry.queue,
  // `queue_id` is read but never written: wrangler validates a producer against
  // `binding`, `queue`, `delivery_delay` and `remote`, and warns on anything else.
  writeback: (entry, _remote, name) => ({ ...entry, queue: name }),
});
