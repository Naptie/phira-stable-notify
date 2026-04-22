import { NCWebsocket } from 'node-napcat-ts';
import type { AllHandlers, TextSegment } from 'node-napcat-ts';
import config from '../config.json' with { type: 'json' };
import { getRecentRequests } from './client.js';

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const batchSize = 50;

const napcat = new NCWebsocket(
  {
    baseUrl: config.napcatWs,
    accessToken: config.napcatToken,
    throwPromise: true,
    reconnection: {
      enable: true,
      attempts: 10,
      delay: 5000
    }
  },
  false
);

// Small generic signallable promise: call `signal()` to resolve the promise.
const createSignallable = <T>() => {
  // start with a noop resolver to avoid definite-assignment / non-null assertions
  let resolver: (value: T) => void = () => undefined as unknown as void;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    signal(value: T) {
      resolver(value);
    }
  } as { promise: Promise<T>; signal: (value: T) => void };
};

const socketClose = createSignallable<void>();

const text = (s: string) =>
  ({
    type: 'text',
    data: { text: s }
  }) satisfies TextSegment;

const toBase62 = (uuidStr: string) => {
  // Remove hyphens to get pure hex
  const hex = uuidStr.replace(/-/g, '');

  // Convert 128-bit hex to a BigInt
  let val = BigInt('0x' + hex);

  // Convert BigInt to Base62
  let b62 = '';
  while (val > 0n) {
    const remainder = Number(val % 62n);
    b62 = BASE62_ALPHABET[remainder] + b62;
    val = val / 62n;
  }
  return b62;
};

const respond = (
  charts: Awaited<ReturnType<typeof getRecentRequests>>,
  isSilent: boolean = false,
  showTime: boolean = true
) => {
  if (charts.length === 0) {
    return isSilent ? undefined : text('未找到符合条件的谱面上架申请。');
  }
  const messages = charts.map((req, i) => {
    const { chart, approvedBy, deniedBy } = req;
    const approvalStr = `✅ ${approvedBy.length > 0 ? approvedBy.join(', ') : '无'}\n`;
    const denialStr = `❌ ${deniedBy.length > 0 ? deniedBy.join(', ') : '无'}\n`;
    const updatedStr = showTime ? `🕓 ${new Date(chart.updated).toLocaleString()}\n` : '';
    const infoStr = `详情：https://phira.moe/chart/${chart.id}\n`;
    const previewStr = `预览：https://player.phizone.cn/?zip=https://ra.phi.zone/${toBase62(chart.file.split('/').slice(-1)[0])}`;
    return (
      `${i % 20 === 0 ? '' : '\n\n'}${i + 1}. #${chart.id} ${chart.name} [${chart.level}]\n` +
      approvalStr +
      denialStr +
      updatedStr +
      infoStr +
      previewStr
    );
  });
  return messages.length > 2
    ? new Array(Math.ceil(messages.length / batchSize)).fill(0).map((_, i) => ({
        type: 'node' as const,
        data: { content: messages.slice(i * batchSize, (i + 1) * batchSize).map((m) => text(m)) }
      }))
    : text(messages.join(''));
};

let isConnected = false;

napcat.on('socket.open', () => {
  isConnected = true;
  console.log('[NapCat] Connected.');
});

napcat.on('socket.close', () => {
  isConnected = false;
  console.log('[NapCat] Disconnected.');
  try {
    socketClose.signal(undefined);
  } catch {
    // ignore if already resolved
  }
});

const constructThresholds = (approvals: number | undefined, denials: number | undefined) => {
  const thresholds = { approvals, denials };
  if (thresholds.approvals === undefined || isNaN(thresholds.approvals)) {
    thresholds.approvals = config.thresholds.approvals;
  }
  if (thresholds.denials === undefined || isNaN(thresholds.denials)) {
    thresholds.denials = config.thresholds.denials;
  }
  return thresholds as { approvals: number; denials: number };
};

napcat.on('message.group.normal', async (context: AllHandlers['message.group.normal']) => {
  const text = context.message
    .find((m) => m.type === 'text')
    ?.data.text?.replace(/^\/sta?bl?e?\s*/, '/stb ');
  if (!text || !text.startsWith('/stb ')) return;
  const group = config.groups.find((g) => g === context.group_id);
  if (!group) return;
  const [appr, deny, withinMins] = text
    .slice(5)
    .trim()
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => parseInt(s, 10))
    .concat([NaN, NaN, NaN]);
  console.log(`[NapCat] Received command: /stb ${appr} ${deny} ${withinMins} from group ${group}`);
  const charts = await getRecentRequests(
    constructThresholds(appr, deny),
    withinMins * 60 * 1000
  ).catch((err) => {
    console.error(`[NapCat] Error fetching recent requests`, err);
    return [];
  });
  const response = respond(charts);
  if (response) {
    if (Array.isArray(response)) {
      for (const segment of response) {
        await napcat.send_group_msg({ group_id: group, message: [segment] }).catch((err) => {
          console.error(`[NapCat] Error sending message`, err);
        });
      }
    } else {
      await napcat.send_group_msg({ group_id: group, message: [response] }).catch((err) => {
        console.error(`[NapCat] Error sending message`, err);
      });
    }
  }
});

await napcat.connect();

const interval = setInterval(async () => {
  if (!isConnected) return;
  try {
    const charts = await getRecentRequests(config.thresholds, config.intervalMillis).catch(
      (err) => {
        console.error(`[NapCat] Error fetching recent requests`, err);
        return [];
      }
    );
    const response = respond(charts, true, false);
    if (response) {
      for (const group of config.groups) {
        if (Array.isArray(response)) {
          for (const segment of response) {
            await napcat.send_group_msg({ group_id: group, message: [segment] }).catch((err) => {
              console.error(`[NapCat] Error sending message`, err);
            });
          }
        } else {
          await napcat.send_group_msg({ group_id: group, message: [response] }).catch((err) => {
            console.error(`[NapCat] Error sending message`, err);
          });
        }
      }
    }
  } catch (err) {
    console.error(`[NapCat] Error in interval task`, err);
  }
}, config.intervalMillis);

let shutdownInitiated = false;
process.on('SIGINT', async () => {
  if (shutdownInitiated) {
    console.log('\nForce exiting...');
    process.exit(1);
  }
  shutdownInitiated = true;
  console.log('\nGracefully shutting down...');

  clearInterval(interval);
  napcat.disconnect();

  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
  await Promise.race([socketClose.promise, timeout]);

  console.log('Process exited.');
  process.exit(0);
});
