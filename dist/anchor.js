import { verifyV2 } from './passport-v2.js';
import { isHash, hex, canonical } from './core.js';

export const CHAIN_ID = '0xaa36a7';
export function anchorData(rootHash) {
  if (!isHash(rootHash)) throw new Error('Неверный хеш для закрепления.');
  return '0x' + hex(new TextEncoder().encode('WECTAS-V2:')) + rootHash;
}
async function checkChain(provider) {
  if (!provider?.request) throw new Error('Нужен браузерный Ethereum-кошелёк. Включите тестовую сеть Sepolia.');
  if ((await provider.request({ method: 'eth_chainId' })).toLowerCase() !== CHAIN_ID) throw new Error('Выберите Sepolia в кошельке. Другие сети заблокированы.');
}
export async function sendAnchor(passport, provider) {
  const result = await verifyV2(passport);
  if (!result.valid || passport.demo) throw new Error('Закреплять можно только исправный паспорт версии 2.');
  await checkChain(provider);
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const sender = accounts[0];
  if (!/^0x[a-fA-F0-9]{40}$/.test(sender)) throw new Error('Кошелёк не предоставил адрес.');
  await checkChain(provider);
  const transactionHash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: sender, to: sender, value: '0x0', data: anchorData(result.rootHash), chainId: CHAIN_ID }] });
  if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) throw new Error('Кошелёк не вернул хеш транзакции.');
  return { network: 'sepolia', chainId: CHAIN_ID, transactionHash, rootHash: result.rootHash, recordCount: passport.records.length, sender };
}
export async function verifyAnchor(passport, anchor, provider) {
  if (!(await verifyV2(passport)).valid || !passport.anchors.some(item => canonical(item) === canonical(anchor))) throw new Error('Некорректный паспорт или ссылка на закрепление.');
  await checkChain(provider);
  const [tx, receipt] = await Promise.all([
    provider.request({ method: 'eth_getTransactionByHash', params: [anchor.transactionHash] }),
    provider.request({ method: 'eth_getTransactionReceipt', params: [anchor.transactionHash] })
  ]);
  await checkChain(provider);
  if (!tx || !receipt) return { verified: false, pending: true, reason: 'Транзакция ещё не включена в блок или не найдена.' };
  if (receipt.status !== '0x1' || tx.hash?.toLowerCase() !== anchor.transactionHash.toLowerCase() ||
    receipt.transactionHash?.toLowerCase() !== anchor.transactionHash.toLowerCase() || tx.input?.toLowerCase() !== anchorData(anchor.rootHash) ||
    tx.from?.toLowerCase() !== anchor.sender.toLowerCase() || tx.to?.toLowerCase() !== anchor.sender.toLowerCase() ||
    tx.value !== '0x0' || (tx.chainId && tx.chainId.toLowerCase() !== CHAIN_ID) || !/^0x[a-fA-F0-9]{64}$/.test(receipt.blockHash) ||
    tx.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase()) return { verified: false, pending: false, reason: 'Сеть не подтверждает указанный хеш и отправителя.' };
  const block = await provider.request({ method: 'eth_getBlockByNumber', params: [receipt.blockNumber, false] });
  if (block?.hash?.toLowerCase() !== receipt.blockHash.toLowerCase() || !block.transactions?.some(hash => hash.toLowerCase() === anchor.transactionHash.toLowerCase()))
    return { verified: false, pending: true, reason: 'Блок изменился или не найден. Повторите проверку.' };
  const finalized = await provider.request({ method: 'eth_getBlockByNumber', params: ['finalized', false] });
  await checkChain(provider);
  return { verified: true, finalized: !!finalized && BigInt(finalized.number) >= BigInt(receipt.blockNumber),
    current: anchor.rootHash === passport.records.at(-1).hash, recordCount: anchor.recordCount, blockNumber: receipt.blockNumber };
}
