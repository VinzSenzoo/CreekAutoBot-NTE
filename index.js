import blessed from "blessed";
import chalk from "chalk";
import figlet from "figlet";
import { SuiClient } from "@mysten/sui.js/client";
import { Ed25519Keypair } from "@mysten/sui.js/keypairs/ed25519";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { decodeSuiPrivateKey } from "@mysten/sui.js/cryptography";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import axios from "axios";

const CREEK_RPC_URL = "https://fullnode.testnet.sui.io";
const USDC_TYPE = "0xa03cb0b29e92c6fa9bfb7b9c57ffdba5e23810f20885b4390f724553d32efb8b::usdc::USDC";
const GUSD_TYPE = "0x5434351f2dcae30c0c4b97420475c5edc966b02fd7d0bbe19ea2220d2f623586::coin_gusd::COIN_GUSD";
const XAUM_TYPE = "0xa03cb0b29e92c6fa9bfb7b9c57ffdba5e23810f20885b4390f724553d32efb8b::coin_xaum::COIN_XAUM";
const GR_TYPE = "0x5504354cf3dcbaf64201989bc734e97c1d89bba5c7f01ff2704c43192cc2717c::coin_gr::COIN_GR";
const GY_TYPE = "0x0ac2d5ebd2834c0db725eedcc562c60fa8e281b1772493a4d199fd1e70065671::coin_gy::COIN_GY";
const SUI_TYPE = "0x2::sui::SUI";
const MARKET_OBJECT = "0x166dd68901d2cb47b55c7cfbb7182316f84114f9e12da9251fd4c4f338e37f5d";
const USDC_VAULT_OBJECT = "0x1fc1b07f7c1d06d4d8f0b1d0a2977418ad71df0d531c476273a2143dfeffba0e";
const STAKING_MANAGER_OBJECT = "0x5c9d26e8310f740353eac0e67c351f71bad8748cf5ac90305ffd32a5f3326990";
const CLOCK_OBJECT = "0x0000000000000000000000000000000000000000000000000000000000000006";
const PACKAGE_ID = "0x8cee41afab63e559bc236338bfd7c6b2af07c9f28f285fc8246666a7ce9ae97a";
const SWAP_MODULE_NAME = "gusd_usdc_vault";
const STAKING_MODULE_NAME = "staking_manager";
const DECIMALS = 9;
const SUI_DECIMALS = 9;
const CONFIG_FILE = "config.json";
const isDebug = false;

const swapDirections = [
  { from: "USDC", to: "GUSD", coinTypeIn: USDC_TYPE, coinTypeOut: GUSD_TYPE, function: "mint_gusd" },
  { from: "GUSD", to: "USDC", coinTypeIn: GUSD_TYPE, coinTypeOut: USDC_TYPE, function: "redeem_gusd" }
];

let walletInfo = {
  address: "N/A",
  balanceSUI: "0.0000",
  balanceUSDC: "0.0000",
  balanceGUSD: "0.0000",
  balanceXAUM: "0.0000",
  activeAccount: "N/A"
};
let transactionLogs = [];
let activityRunning = false;
let isCycleRunning = false;
let shouldStop = false;
let dailyActivityInterval = null;
let accounts = [];
let proxies = [];
let selectedWalletIndex = 0;
let loadingSpinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const borderBlinkColors = ["cyan", "blue", "magenta", "red", "yellow", "green"];
let borderBlinkIndex = 0;
let blinkCounter = 0;
let spinnerIndex = 0;
let hasLoggedSleepInterrupt = false;
let isHeaderRendered = false;
let activeProcesses = 0;

let dailyActivityConfig = {
  swapRepetitions: 1,
  stakeRepetitions: 1,
  unstakeRepetitions: 1, 
  usdcSwapRange: { min: 1, max: 2 },
  gusdSwapRange: { min: 1, max: 2 },
  xaumStakeRange: { min: 0.01, max: 0.02 },
  xaumUnstakeRange: { min: 0.01, max: 0.02 },
  loopHours: 24
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf8");
      const config = JSON.parse(data);
      dailyActivityConfig.swapRepetitions = Number(config.swapRepetitions) || 1;
      dailyActivityConfig.stakeRepetitions = Number(config.stakeRepetitions) || 1;
      dailyActivityConfig.unstakeRepetitions = Number(config.unstakeRepetitions) || 1; 
      dailyActivityConfig.usdcSwapRange.min = Number(config.usdcSwapRange?.min) || 1;
      dailyActivityConfig.usdcSwapRange.max = Number(config.usdcSwapRange?.max) || 2;
      dailyActivityConfig.gusdSwapRange.min = Number(config.gusdSwapRange?.min) || 1;
      dailyActivityConfig.gusdSwapRange.max = Number(config.gusdSwapRange?.max) || 2;
      dailyActivityConfig.xaumStakeRange.min = Number(config.xaumStakeRange?.min) || 0.01;
      dailyActivityConfig.xaumStakeRange.max = Number(config.xaumStakeRange?.max) || 0.02;
      dailyActivityConfig.xaumUnstakeRange.min = Number(config.xaumUnstakeRange?.min) || 0.01;
      dailyActivityConfig.xaumUnstakeRange.max = Number(config.xaumUnstakeRange?.max) || 0.02;
      dailyActivityConfig.loopHours = Number(config.loopHours) || 24;
    } else {
      addLog("No config file found, using default settings.", "info");
    }
  } catch (error) {
    addLog(`Failed to load config: ${error.message}`, "error");
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(dailyActivityConfig, null, 2));
    addLog("Configuration saved successfully.", "success");
  } catch (error) {
    addLog(`Failed to save config: ${error.message}`, "error");
  }
}

process.on("unhandledRejection", (reason) => {
  addLog(`Unhandled Rejection: ${reason.message || reason}`, "error");
});

process.on("uncaughtException", (error) => {
  addLog(`Uncaught Exception: ${error.message}\n${error.stack}`, "error");
  process.exit(1);
});

function getShortAddress(address) {
  return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A";
}

function addLog(message, type = "info") {
  if (type === "debug" && !isDebug) return;
  const timestamp = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
  let coloredMessage;
  switch (type) {
    case "error":
      coloredMessage = chalk.redBright(message);
      break;
    case "success":
      coloredMessage = chalk.greenBright(message);
      break;
    case "warn":
      coloredMessage = chalk.magentaBright(message);
      break;
    case "wait":
      coloredMessage = chalk.yellowBright(message);
      break;
    case "info":
      coloredMessage = chalk.whiteBright(message);
      break;
    case "delay":
      coloredMessage = chalk.cyanBright(message);
      break;
    case "debug":
      coloredMessage = chalk.blueBright(message);
      break;
    default:
      coloredMessage = chalk.white(message);
  }
  const logMessage = `[${timestamp}] ${coloredMessage}`;
  transactionLogs.push(logMessage);
  updateLogs();
}

function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}

function clearTransactionLogs() {
  transactionLogs = [];
  logBox.setContent('');
  logBox.scrollTo(0);
  addLog("Transaction logs cleared.", "success");
}

function loadAccounts() {
  try {
    const data = fs.readFileSync("pk.txt", "utf8");
    accounts = data.split("\n").map(line => line.trim()).filter(line => line).map(privateKey => ({ privateKey }));
    if (accounts.length === 0) {
      throw new Error("No private keys found in pk.txt");
    }
    addLog(`Loaded ${accounts.length} accounts from pk.txt`, "success");
  } catch (error) {
    addLog(`Failed to load accounts: ${error.message}`, "error");
    accounts = [];
  }
}

function loadProxies() {
  try {
    if (fs.existsSync("proxy.txt")) {
      const data = fs.readFileSync("proxy.txt", "utf8");
      proxies = data.split("\n").map(proxy => proxy.trim()).filter(proxy => proxy);
      if (proxies.length === 0) throw new Error("No proxy found in proxy.txt");
      addLog(`Loaded ${proxies.length} proxies from proxy.txt`, "success");
    } else {
      addLog("No proxy.txt found, running without proxy.", "info");
    }
  } catch (error) {
    addLog(`Failed to load proxy: ${error.message}`, "info");
    proxies = [];
  }
}

function createAgent(proxyUrl) {
  if (!proxyUrl) return null;
  if (proxyUrl.startsWith("socks")) {
    return new SocksProxyAgent(proxyUrl);
  } else {
    return new HttpsProxyAgent(proxyUrl);
  }
}

function getClient(proxyUrl) {
  const transport = {
    async request(rpcRequest) {
      try {
        const fullRequest = {
          jsonrpc: "2.0",
          id: Math.floor(Math.random() * 100000),
          method: rpcRequest.method,
          params: rpcRequest.params
        };
        const agent = createAgent(proxyUrl);
        const config = agent ? { httpsAgent: agent } : {};
        if (isDebug) {
          addLog(`Debug: Sending RPC request: ${JSON.stringify(fullRequest)}`, "debug");
        }
        const response = await axios.post(CREEK_RPC_URL, fullRequest, config);

        if (isDebug) {
          addLog(`Debug: Raw RPC response: ${JSON.stringify(response.data)}`, "debug");
        }

        return response.data && response.data.result ? response.data.result : response.data;
      } catch (error) {
        addLog(`RPC request failed: ${error.message}`, "error");
        throw error;
      }
    }
  };
  return new SuiClient({ url: CREEK_RPC_URL, transport });
}

async function sleep(ms) {
  if (shouldStop) {
    if (!hasLoggedSleepInterrupt) {
      addLog("Process stopped successfully.", "info");
      hasLoggedSleepInterrupt = true;
    }
    return;
  }
  activeProcesses++;
  try {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, ms);
      const checkStop = setInterval(() => {
        if (shouldStop) {
          clearTimeout(timeout);
          clearInterval(checkStop);
          if (!hasLoggedSleepInterrupt) {
            addLog("Process interrupted.", "info");
            hasLoggedSleepInterrupt = true;
          }
          resolve();
        }
      }, 100);
    });
  } catch (error) {
    addLog(`Sleep error: ${error.message}`, "error");
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

function formatBalance(totalBalance, decimals) {
  try {
    if (totalBalance == null) return '0.0000';
    const bigBalance = BigInt(totalBalance.toString());
    const divisor = BigInt(10) ** BigInt(decimals);
    const integer = bigBalance / divisor;
    const fraction = ((bigBalance % divisor) * (BigInt(10) ** BigInt(4))) / divisor;
    const formattedFraction = fraction.toString().padStart(4, '0');
    return `${integer.toString()}.${formattedFraction}`;
  } catch (err) {
    addLog(`formatBalance error: ${err.message}`, "debug");
    return '0.0000';
  }
}


async function updateWalletData() {
  const walletDataPromises = accounts.map(async (account, i) => {
    try {
      const proxyUrl = proxies[i % proxies.length] || null;
      const client = getClient(proxyUrl);
      const { secretKey } = decodeSuiPrivateKey(account.privateKey);
      const keypair = Ed25519Keypair.fromSecretKey(secretKey);
      const address = keypair.toSuiAddress();

      const suiBalance = await client.getBalance({ owner: address, coinType: SUI_TYPE });
      const formattedSUI = formatBalance(suiBalance.totalBalance, SUI_DECIMALS);

      const usdcBalance = await client.getBalance({ owner: address, coinType: USDC_TYPE });
      const formattedUSDC = formatBalance(usdcBalance.totalBalance, DECIMALS);

      const gusdBalance = await client.getBalance({ owner: address, coinType: GUSD_TYPE });
      const formattedGUSD = formatBalance(gusdBalance.totalBalance, DECIMALS);

      const xaumBalance = await client.getBalance({ owner: address, coinType: XAUM_TYPE });
      const formattedXAUM = formatBalance(xaumBalance.totalBalance, DECIMALS);

      const formattedEntry = `${i === selectedWalletIndex ? "→ " : "  "}${chalk.bold.magentaBright(getShortAddress(address))}    ${chalk.bold.cyanBright(formattedSUI.padEnd(8))}  ${chalk.bold.cyanBright(formattedUSDC.padEnd(8))}  ${chalk.bold.cyanBright(formattedGUSD.padEnd(8))}  ${chalk.bold.cyanBright(formattedXAUM.padEnd(8))}`;

      if (i === selectedWalletIndex) {
        walletInfo.address = address;
        walletInfo.activeAccount = `Account ${i + 1}`;
        walletInfo.balanceSUI = formattedSUI;
        walletInfo.balanceUSDC = formattedUSDC;
        walletInfo.balanceGUSD = formattedGUSD;
        walletInfo.balanceXAUM = formattedXAUM;
      }
      return formattedEntry;
    } catch (error) {
      addLog(`Failed to fetch wallet data for account #${i + 1}: ${error.message}`, "error");
      return `${i === selectedWalletIndex ? "→ " : "  "}N/A 0.000000 0.000000 0.000000 0.000000`;
    }
  });
  try {
    const walletData = await Promise.all(walletDataPromises);
    addLog("Wallet data updated.", "success");
    return walletData;
  } catch (error) {
    addLog(`Wallet data update failed: ${error.message}`, "error");
    return [];
  }
}

async function performSwap(keypair, direction, amount, proxyUrl) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid amount");
  const amountIn = BigInt(Math.round(amountNum * Math.pow(10, DECIMALS)));

  const coinsResp = await client.getCoins({ owner: address, coinType: direction.coinTypeIn });
  const coins = Array.isArray(coinsResp?.data) ? coinsResp.data : [];
  if (coins.length === 0) throw new Error(`No ${direction.from} coins found`);

  const coinIds = coins.map(c => c.coinObjectId);
  const [primaryId, ...otherIds] = coinIds;
  const chosen = coinIds.find(id => {
    const c = coins.find(x => x.coinObjectId === id);
    const bal = c?.balance ?? c?.totalBalance ?? null;
    return bal != null && BigInt(bal) >= amountIn;
  }) ?? primaryId;

  const tx = new TransactionBlock();
  if (otherIds.length > 0) {
    const othersToMerge = coinIds.filter(id => id !== chosen);
    if (othersToMerge.length > 0) tx.mergeCoins(tx.object(chosen), othersToMerge.map(id => tx.object(id)));
  }
  const splitResult = tx.splitCoins(tx.object(chosen), [tx.pure(amountIn)]);
  const target = `${PACKAGE_ID}::${SWAP_MODULE_NAME}::${direction.function}`;
  if (direction.from === "USDC") {
    tx.moveCall({
      target,
      arguments: [ tx.object(USDC_VAULT_OBJECT), tx.object(MARKET_OBJECT), splitResult, tx.object(CLOCK_OBJECT) ]
    });
  } else {
    tx.moveCall({
      target,
      arguments: [ tx.object(USDC_VAULT_OBJECT), tx.object(MARKET_OBJECT), splitResult ]
    });
  }

  if (typeof isDebug !== "undefined" && isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error: ${e.message}`, "debug");
    }
  }

  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`Swap Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }

  if (sendResult?.effects) {
    addLog(`Result.effects (local): ${JSON.stringify(sendResult.effects)}`, "debug");
    const status = sendResult.effects?.status?.status ?? sendResult.effects?.status;
    if (status === "success" || status === "ok") {
      addLog(`Swap Successfully, Hash: ${getShortHash(sendResult.digest)}`, "success");
      return sendResult;
    } else {
      addLog(`Transaction failed according to local effects: ${JSON.stringify(sendResult.effects?.status)}`, "error");
      throw new Error("Transaction failed according to local effects");
    }
  }

  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }

  if (!receipt) {
    addLog(`Could not fetch transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    addLog(`Hint: cek RPC endpoint (apakah node yang sama dengan yang menerima tx?), atau tunggu beberapa detik lalu cek di explorer.`, "error");
    throw new Error("No receipt found after polling");
  }

  addLog(`Receipt effects: ${JSON.stringify(receipt.effects ?? receipt)}`, "debug");
  const status = (receipt.effects?.status?.status) ?? (receipt.effects?.status ?? null);
  if (status !== "success") {
    const errMsg = receipt.effects?.status?.error ?? null;
    addLog(`Transaction effects indicate failure. Error: ${errMsg}`, "error");
    addLog(`Full receipt: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`Transaction failed: ${errMsg ?? "no error message in effects"}`);
  }

  addLog(`Swap ${amount} ${direction.from} ➯ ${direction.to} success, Hash ${getShortHash(digest)}`, "success");
  return receipt;
}

async function performStake(keypair, amount, proxyUrl) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid stake amount");
  const amountIn = BigInt(Math.round(amountNum * Math.pow(10, DECIMALS)));

  const xaumBalance = await client.getBalance({ owner: address, coinType: XAUM_TYPE });
  const formattedXAUM = formatBalance(xaumBalance.totalBalance, DECIMALS);
  addLog(`Current XAUM balance before staking: ${formattedXAUM} XAUM`, "info");

  const coinsResp = await client.getCoins({ owner: address, coinType: XAUM_TYPE });
  const coins = Array.isArray(coinsResp?.data) ? coinsResp.data : [];
  if (coins.length === 0) throw new Error("No XAUM coins found");

  const coinIds = coins.map(c => c.coinObjectId);
  const [primaryId, ...otherIds] = coinIds;
  const chosen = coinIds.find(id => {
    const c = coins.find(x => x.coinObjectId === id);
    const bal = c?.balance ?? c?.totalBalance ?? null;
    return bal != null && BigInt(bal) >= amountIn;
  }) ?? primaryId;

  const tx = new TransactionBlock();
  if (otherIds.length > 0) {
    const othersToMerge = coinIds.filter(id => id !== chosen);
    if (othersToMerge.length > 0) tx.mergeCoins(tx.object(chosen), othersToMerge.map(id => tx.object(id)));
  }
  const splitResult = tx.splitCoins(tx.object(chosen), [tx.pure(amountIn)]);

  tx.moveCall({
    target: `${PACKAGE_ID}::${STAKING_MODULE_NAME}::stake_xaum`,
    arguments: [tx.object(STAKING_MANAGER_OBJECT), splitResult]
  });

  if (isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect for stake: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error for stake: ${e.message}`, "debug");
    }
  }

  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`Stake Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error for stake: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail for stake: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }

  if (sendResult?.effects) {
    addLog(`Result.effects (local) for stake: ${JSON.stringify(sendResult.effects)}`, "debug");
    const status = sendResult.effects?.status?.status ?? sendResult.effects?.status;
    if (status === "success" || status === "ok") {
      addLog(`Stake Successfully: ${getShortHash(sendResult.digest)}`, "success");
      return sendResult;
    } else {
      addLog(`Stake failed according to local effects: ${JSON.stringify(sendResult.effects?.status)}`, "error");
      throw new Error("Stake failed according to local effects");
    }
  }

  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed for stake: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error for stake: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }

  if (!receipt) {
    addLog(`Could not fetch stake transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling for stake");
  }

  addLog(`Receipt effects for stake: ${JSON.stringify(receipt.effects ?? receipt)}`, "debug");
  const status = (receipt.effects?.status?.status) ?? (receipt.effects?.status ?? null);
  if (status !== "success") {
    const errMsg = receipt.effects?.status?.error ?? null;
    addLog(`Stake effects indicate failure. Error: ${errMsg}`, "error");
    addLog(`Full receipt for stake: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`Stake failed: ${errMsg ?? "no error message in effects"}`);
  }

  addLog(`Stake ${amount} XAUM success, Hash ${getShortHash(digest)}`, "success");
  return receipt;
}

async function performUnstake(keypair, amount, proxyUrl) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid unstake amount");
  const grGyAmountIn = BigInt(Math.round(amountNum * 100 * Math.pow(10, DECIMALS)));

  const grBalance = await client.getBalance({ owner: address, coinType: GR_TYPE });
  const gyBalance = await client.getBalance({ owner: address, coinType: GY_TYPE });
  const formattedGR = parseFloat(formatBalance(grBalance.totalBalance, DECIMALS));
  const formattedGY = parseFloat(formatBalance(gyBalance.totalBalance, DECIMALS));
  const maxUnstake = Math.min(formattedGR / 100, formattedGY / 100);
  addLog(`Max XAUM that can be unstaked: ${maxUnstake.toFixed(4)} XAUM`, "info");

  if (amountNum > maxUnstake) {
    throw new Error(`Insufficient GR/GY for unstaking ${amount} XAUM. Max: ${maxUnstake.toFixed(4)} XAUM`);
  }
  const grCoinsResp = await client.getCoins({ owner: address, coinType: GR_TYPE });
  const grCoins = Array.isArray(grCoinsResp?.data) ? grCoinsResp.data : [];
  if (grCoins.length === 0) throw new Error("No GR coins found");

  const grCoinIds = grCoins.map(c => c.coinObjectId);
  const [grPrimaryId, ...grOtherIds] = grCoinIds;
  const grChosen = grCoinIds.find(id => {
    const c = grCoins.find(x => x.coinObjectId === id);
    const bal = c?.balance ?? c?.totalBalance ?? null;
    return bal != null && BigInt(bal) >= grGyAmountIn;
  }) ?? grPrimaryId;

  const gyCoinsResp = await client.getCoins({ owner: address, coinType: GY_TYPE });
  const gyCoins = Array.isArray(gyCoinsResp?.data) ? gyCoinsResp.data : [];
  if (gyCoins.length === 0) throw new Error("No GY coins found");

  const gyCoinIds = gyCoins.map(c => c.coinObjectId);
  const [gyPrimaryId, ...gyOtherIds] = gyCoinIds;
  const gyChosen = gyCoinIds.find(id => {
    const c = gyCoins.find(x => x.coinObjectId === id);
    const bal = c?.balance ?? c?.totalBalance ?? null;
    return bal != null && BigInt(bal) >= grGyAmountIn;
  }) ?? gyPrimaryId;

  const tx = new TransactionBlock();

  if (grOtherIds.length > 0) {
    const grOthersToMerge = grCoinIds.filter(id => id !== grChosen);
    if (grOthersToMerge.length > 0) tx.mergeCoins(tx.object(grChosen), grOthersToMerge.map(id => tx.object(id)));
  }
  const grSplitResult = tx.splitCoins(tx.object(grChosen), [tx.pure(grGyAmountIn)]);

  if (gyOtherIds.length > 0) {
    const gyOthersToMerge = gyCoinIds.filter(id => id !== gyChosen);
    if (gyOthersToMerge.length > 0) tx.mergeCoins(tx.object(gyChosen), gyOthersToMerge.map(id => tx.object(id)));
  }
  const gySplitResult = tx.splitCoins(tx.object(gyChosen), [tx.pure(grGyAmountIn)]);

  tx.moveCall({
    target: `${PACKAGE_ID}::${STAKING_MODULE_NAME}::unstake`,
    arguments: [tx.object(STAKING_MANAGER_OBJECT), grSplitResult, gySplitResult]
  });

  if (isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect for unstake: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error for unstake: ${e.message}`, "debug");
    }
  }

  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`Unstake Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error for unstake: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail for unstake: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }

  if (sendResult?.effects) {
    addLog(`Result.effects (local) for unstake: ${JSON.stringify(sendResult.effects)}`, "debug");
    const status = sendResult.effects?.status?.status ?? sendResult.effects?.status;
    if (status === "success" || status === "ok") {
      addLog(`Unstake Successfully , Hash: ${getShortHash(sendResult.digest)}`, "success");
      return sendResult;
    } else {
      addLog(`Unstake failed according to local effects: ${JSON.stringify(sendResult.effects?.status)}`, "error");
      throw new Error("Unstake failed according to local effects");
    }
  }

  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed for unstake: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error for unstake: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }

  if (!receipt) {
    addLog(`Could not fetch unstake transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling for unstake");
  }

  addLog(`Receipt effects for unstake: ${JSON.stringify(receipt.effects ?? receipt)}`, "debug");
  const status = (receipt.effects?.status?.status) ?? (receipt.effects?.status ?? null);
  if (status !== "success") {
    const errMsg = receipt.effects?.status?.error ?? null;
    addLog(`Unstake effects indicate failure. Error: ${errMsg}`, "error");
    addLog(`Full receipt for unstake: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`Unstake failed: ${errMsg ?? "no error message in effects"}`);
  }

  addLog(`Unstake ${amount} XAUM success, Hash ${getShortHash(digest)}`, "success");
  return receipt;
}

async function runDailyActivity() {
  if (accounts.length === 0) {
    addLog("No valid accounts found.", "error");
    return;
  }
  addLog(`Starting daily activity for all accounts. Auto Swap: ${dailyActivityConfig.swapRepetitions}x | Auto Stake: ${dailyActivityConfig.stakeRepetitions}x | Auto Unstake: ${dailyActivityConfig.unstakeRepetitions}x`, "info");
  activityRunning = true;
  isCycleRunning = true;
  shouldStop = false;
  hasLoggedSleepInterrupt = false;
  activeProcesses = Math.max(0, activeProcesses);
  updateMenu();
  try {
    for (let accountIndex = 0; accountIndex < accounts.length && !shouldStop; accountIndex++) {
      addLog(`Starting processing for account ${accountIndex + 1}`, "info");
      selectedWalletIndex = accountIndex;
      const proxyUrl = proxies[accountIndex % proxies.length] || null;
      addLog(`Account ${accountIndex + 1}: Using Proxy ${proxyUrl || "none"}`, "info");
      const { secretKey } = decodeSuiPrivateKey(accounts[accountIndex].privateKey);
      const keypair = Ed25519Keypair.fromSecretKey(secretKey);
      const address = keypair.toSuiAddress();
      if (!address.startsWith("0x")) {
        addLog(`Invalid wallet address for account ${accountIndex + 1}: ${address}`, "error");
        continue;
      }
      addLog(`Processing account ${accountIndex + 1}: ${getShortAddress(address)}`, "wait");

      let directionIndex = 0;
      for (let swapCount = 0; swapCount < dailyActivityConfig.swapRepetitions && !shouldStop; swapCount++) {
        const currentDirection = swapDirections[directionIndex % swapDirections.length];
        let amount;
        if (currentDirection.from === "USDC") {
          amount = (Math.random() * (dailyActivityConfig.usdcSwapRange.max - dailyActivityConfig.usdcSwapRange.min) + dailyActivityConfig.usdcSwapRange.min).toFixed(3);
        } else if (currentDirection.from === "GUSD") {
          amount = (Math.random() * (dailyActivityConfig.gusdSwapRange.max - dailyActivityConfig.gusdSwapRange.min) + dailyActivityConfig.gusdSwapRange.min).toFixed(3);
        }
        addLog(`Account ${accountIndex + 1} - Swap ${swapCount + 1}: ${amount} ${currentDirection.from} ➯ ${currentDirection.to}`, "warn");
        try {
          await performSwap(keypair, currentDirection, amount, proxyUrl);
        } catch (error) {
          addLog(`Account ${accountIndex + 1} - Swap ${swapCount + 1} (${currentDirection.from} ➯ ${currentDirection.to}): Failed: ${error.message}. Skipping.`, "error");
        } finally {
          await sleep(3000);
          await updateWallets();
        }

        directionIndex++;

        if (swapCount < dailyActivityConfig.swapRepetitions - 1 && !shouldStop) {
          const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
          addLog(`Account ${accountIndex + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next swap...`, "delay");
          await sleep(randomDelay);
        }
      }

      if (!shouldStop) {
        addLog(`Account ${accountIndex + 1} - Waiting 10 seconds before starting staking...`, "delay");
        await sleep(10000);
      }

      for (let stakeCount = 0; stakeCount < dailyActivityConfig.stakeRepetitions && !shouldStop; stakeCount++) {
        const stakeAmount = (Math.random() * (dailyActivityConfig.xaumStakeRange.max - dailyActivityConfig.xaumStakeRange.min) + dailyActivityConfig.xaumStakeRange.min).toFixed(4);
        addLog(`Account ${accountIndex + 1} - Stake ${stakeCount + 1}: ${stakeAmount} XAUM`, "warn");
        try {
          await performStake(keypair, stakeAmount, proxyUrl);
        } catch (error) {
          addLog(`Account ${accountIndex + 1} - Stake ${stakeCount + 1}: Failed: ${error.message}. Skipping.`, "error");
        } finally {
          await sleep(3000);
          await updateWallets();
        }

        if (stakeCount < dailyActivityConfig.stakeRepetitions - 1 && !shouldStop) {
          const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
          addLog(`Account ${accountIndex + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next stake...`, "delay");
          await sleep(randomDelay);
        }
      }

      if (!shouldStop) {
        addLog(`Account ${accountIndex + 1} - Waiting 10 seconds before starting unstaking...`, "delay");
        await sleep(10000);
      }

      for (let unstakeCount = 0; unstakeCount < dailyActivityConfig.unstakeRepetitions && !shouldStop; unstakeCount++) {
        const unstakeAmount = (Math.random() * (dailyActivityConfig.xaumUnstakeRange.max - dailyActivityConfig.xaumUnstakeRange.min) + dailyActivityConfig.xaumUnstakeRange.min).toFixed(4);
        addLog(`Account ${accountIndex + 1} - Unstake ${unstakeCount + 1}: ${unstakeAmount} XAUM`, "warn");
        try {
          await performUnstake(keypair, unstakeAmount, proxyUrl);
        } catch (error) {
          addLog(`Account ${accountIndex + 1} - Unstake ${unstakeCount + 1}: Failed: ${error.message}. Skipping.`, "error");
        } finally {
          await sleep(3000);
          await updateWallets();
        }

        if (unstakeCount < dailyActivityConfig.unstakeRepetitions - 1 && !shouldStop) {
          const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
          addLog(`Account ${accountIndex + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next unstake...`, "delay");
          await sleep(randomDelay);
        }
      }

      if (accountIndex < accounts.length - 1 && !shouldStop) {
        addLog(`Waiting 10 seconds before next account...`, "delay");
        await sleep(10000);
      }
    }
    if (!shouldStop && activeProcesses <= 0) {
      addLog(`All accounts processed. Waiting ${dailyActivityConfig.loopHours} hours for next cycle.`, "success");
      dailyActivityInterval = setTimeout(runDailyActivity, dailyActivityConfig.loopHours * 60 * 60 * 1000);
    }
  } catch (error) {
    addLog(`Daily activity failed: ${error.message}`, "error");
  } finally {
    if (shouldStop) {
      if (activeProcesses <= 0) {
        if (dailyActivityInterval) {
          clearTimeout(dailyActivityInterval);
          dailyActivityInterval = null;
          addLog("Cleared daily activity interval.", "info");
        }
        activityRunning = false;
        isCycleRunning = false;
        shouldStop = false;
        hasLoggedSleepInterrupt = false;
        activeProcesses = 0;
        addLog("Daily activity stopped successfully.", "success");
        updateMenu();
        updateStatus();
        safeRender();
      } else {
        const stopCheckInterval = setInterval(() => {
          if (activeProcesses <= 0) {
            clearInterval(stopCheckInterval);
            if (dailyActivityInterval) {
              clearTimeout(dailyActivityInterval);
              dailyActivityInterval = null;
              addLog("Cleared daily activity interval.", "info");
            }
            activityRunning = false;
            isCycleRunning = false;
            shouldStop = false;
            hasLoggedSleepInterrupt = false;
            activeProcesses = 0;
            addLog("Daily activity stopped successfully.", "success");
            updateMenu();
            updateStatus();
            safeRender();
          } else {
            addLog(`Waiting for ${activeProcesses} process to complete...`, "info");
          }
        }, 1000);
      }
    } else {
      activityRunning = false;
      isCycleRunning = activeProcesses > 0 || dailyActivityInterval !== null;
      updateMenu();
      updateStatus();
      safeRender();
    }
  }
}

const screen = blessed.screen({
  smartCSR: true,
  title: "CREEK AUTO BOT",
  autoPadding: true,
  fullUnicode: true,
  mouse: true,
  ignoreLocked: ["C-c", "q", "escape"]
});

const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  height: 6,
  tags: true,
  style: { fg: "yellow", bg: "default" }
});

const statusBox = blessed.box({
  left: 0,
  top: 6,
  width: "100%",
  height: 3,
  tags: true,
  border: { type: "line", fg: "cyan" },
  style: { fg: "white", bg: "default", border: { fg: "cyan" } },
  content: "Status: Initializing...",
  padding: { left: 1, right: 1, top: 0, bottom: 0 },
  label: chalk.cyan(" Status "),
  wrap: true
});

const walletBox = blessed.list({
  label: " Wallet Information",
  top: 9,
  left: 0,
  width: "40%",
  height: "35%",
  border: { type: "line", fg: "cyan" },
  style: { border: { fg: "cyan" }, fg: "white", bg: "default", item: { fg: "white" } },
  scrollable: true,
  scrollbar: { bg: "cyan", fg: "black" },
  padding: { left: 1, right: 1, top: 0, bottom: 0 },
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
  content: "Loading wallet data..."
});

const logBox = blessed.log({
  label: " Transaction Logs",
  top: 9,
  left: "41%",
  width: "59%",
  height: "100%-9",
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  tags: true,
  scrollbar: { ch: "│", style: { bg: "cyan", fg: "white" }, track: { bg: "gray" } },
  scrollback: 100,
  smoothScroll: true,
  style: { border: { fg: "magenta" }, bg: "default", fg: "white" },
  padding: { left: 1, right: 1, top: 0, bottom: 0 },
  wrap: true,
  focusable: true,
  keys: true
});

const menuBox = blessed.list({
  label: " Menu ",
  top: "44%",
  left: 0,
  width: "40%",
  height: "56%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "magenta", fg: "black" }, item: { fg: "white" } },
  items: isCycleRunning
    ? ["Stop Activity", "Set Manual Config", "Clear Logs", "Refresh", "Exit"]
    : ["Start Auto Daily Activity", "Set Manual Config", "Clear Logs", "Refresh", "Exit"],
  padding: { left: 1, top: 1 }
});

const dailyActivitySubMenu = blessed.list({
  label: " Manual Config Options ",
  top: "44%",
  left: 0,
  width: "40%",
  height: "56%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "blue" },
    selected: { bg: "blue", fg: "black" },
    item: { fg: "white" }
  },
  items: [
    "Set Swap Repetitions",
    "Set Stake Repetitions",
    "Set Unstake Repetitions", 
    "Set USDC Swap Range",
    "Set GUSD Swap Range",
    "Set XAUM Stake Range",
    "Set XAUM Unstake Range", 
    "Set Loop Daily",
    "Back to Main Menu"
  ],
  padding: { left: 1, top: 1 },
  hidden: true
});

const configForm = blessed.form({
  label: " Enter Config Value ",
  top: "center",
  left: "center",
  width: "30%",
  height: "40%",
  keys: true,
  mouse: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "blue" }
  },
  padding: { left: 1, top: 1 },
  hidden: true
});

const minLabel = blessed.text({
  parent: configForm,
  top: 0,
  left: 1,
  content: "Min Value:",
  style: { fg: "white" }
});

const maxLabel = blessed.text({
  parent: configForm,
  top: 4,
  left: 1,
  content: "Max Value:",
  style: { fg: "white" }
});

const configInput = blessed.textbox({
  parent: configForm,
  top: 1,
  left: 1,
  width: "90%",
  height: 3,
  inputOnFocus: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "white" },
    focus: { border: { fg: "green" } }
  }
});

const configInputMax = blessed.textbox({
  parent: configForm,
  top: 5,
  left: 1,
  width: "90%",
  height: 3,
  inputOnFocus: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "white" },
    focus: { border: { fg: "green" } }
  }
});

const configSubmitButton = blessed.button({
  parent: configForm,
  top: 9,
  left: "center",
  width: 10,
  height: 3,
  content: "Submit",
  align: "center",
  border: { type: "line" },
  clickable: true,
  keys: true,
  mouse: true,
  style: {
    fg: "white",
    bg: "blue",
    border: { fg: "white" },
    hover: { bg: "green" },
    focus: { bg: "green", border: { fg: "yellow" } }
  }
});

screen.append(headerBox);
screen.append(statusBox);
screen.append(walletBox);
screen.append(logBox);
screen.append(menuBox);
screen.append(dailyActivitySubMenu);
screen.append(configForm);

let renderQueue = [];
let isRendering = false;
function safeRender() {
  renderQueue.push(true);
  if (isRendering) return;
  isRendering = true;
  setTimeout(() => {
    try {
      if (!isHeaderRendered) {
        figlet.text("NT EXHAUST", { font: "ANSI Shadow" }, (err, data) => {
          if (!err) headerBox.setContent(`{center}{bold}{cyan-fg}${data}{/cyan-fg}{/bold}{/center}`);
          isHeaderRendered = true;
        });
      }
      screen.render();
    } catch (error) {
      addLog(`UI render error: ${error.message}`, "error");
    }
    renderQueue.shift();
    isRendering = false;
    if (renderQueue.length > 0) safeRender();
  }, 100);
}

function adjustLayout() {
  const screenHeight = screen.height || 24;
  const screenWidth = screen.width || 80;
  headerBox.height = Math.max(6, Math.floor(screenHeight * 0.15));
  statusBox.top = headerBox.height;
  statusBox.height = Math.max(3, Math.floor(screenHeight * 0.07));
  statusBox.width = screenWidth - 2;
  walletBox.top = headerBox.height + statusBox.height;
  walletBox.width = Math.floor(screenWidth * 0.4);
  walletBox.height = Math.floor(screenHeight * 0.35);
  logBox.top = headerBox.height + statusBox.height;
  logBox.left = Math.floor(screenWidth * 0.41);
  logBox.width = screenWidth - walletBox.width - 2;
  logBox.height = screenHeight - (headerBox.height + statusBox.height);
  menuBox.top = headerBox.height + statusBox.height + walletBox.height;
  menuBox.width = Math.floor(screenWidth * 0.4);
  menuBox.height = screenHeight - (headerBox.height + statusBox.height + walletBox.height);

  if (menuBox.top != null) {
    dailyActivitySubMenu.top = menuBox.top;
    dailyActivitySubMenu.width = menuBox.width;
    dailyActivitySubMenu.height = menuBox.height;
    dailyActivitySubMenu.left = menuBox.left;
    configForm.width = Math.floor(screenWidth * 0.3);
    configForm.height = Math.floor(screenHeight * 0.4);
  }

  safeRender();
}

function updateStatus() {
  try {
    const isProcessing = activityRunning || (isCycleRunning && dailyActivityInterval !== null);
    const status = activityRunning
      ? `${loadingSpinner[spinnerIndex]} ${chalk.yellowBright("Running")}`
      : isCycleRunning && dailyActivityInterval !== null
      ? `${loadingSpinner[spinnerIndex]} ${chalk.yellowBright("Waiting for next cycle")}`
      : chalk.green("Idle");
    const statusText = `Status: ${status} | Active Account: ${getShortAddress(walletInfo.address)} | Total Accounts: ${accounts.length} | Auto Swap: ${dailyActivityConfig.swapRepetitions}x | Auto Stake: ${dailyActivityConfig.stakeRepetitions}x | Auto Unstake: ${dailyActivityConfig.unstakeRepetitions}x | Loop: ${dailyActivityConfig.loopHours}h | CREEK AUTO BOT`;
    statusBox.setContent(statusText);
    if (isProcessing) {
      if (blinkCounter % 1 === 0) {
        statusBox.style.border.fg = borderBlinkColors[borderBlinkIndex];
        borderBlinkIndex = (borderBlinkIndex + 1) % borderBlinkColors.length;
      }
      blinkCounter++;
    } else {
      statusBox.style.border.fg = "cyan";
    }
    spinnerIndex = (spinnerIndex + 1) % loadingSpinner.length;
    safeRender();
  } catch (error) {
    addLog(`Status update error: ${error.message}`, "error");
  }
}

async function updateWallets() {
  try {
    const walletData = await updateWalletData();
    const header = `${chalk.bold.cyan("  Address").padEnd(20)}           ${chalk.bold.cyan("SUI".padEnd(6))}    ${chalk.bold.cyan("USDC".padEnd(6))}    ${chalk.bold.cyan("GUSD".padEnd(6))}    ${chalk.bold.cyan("XAUM".padEnd(6))}`;
    const separator = chalk.gray("-".repeat(120));
    walletBox.setItems([header, separator, ...walletData]);
    walletBox.select(0);
    safeRender();
  } catch (error) {
    addLog(`Failed to update wallet data: ${error.message}`, "error");
  }
}

function updateLogs() {
  try {
    logBox.add(transactionLogs[transactionLogs.length - 1] || chalk.gray("No logs available."));
    logBox.scrollTo(transactionLogs.length);
    safeRender();
  } catch (error) {
    addLog(`Log update failed: ${error.message}`, "error");
  }
}

function updateMenu() {
  try {
    menuBox.setItems(
      isCycleRunning
        ? ["Stop Activity", "Set Manual Config", "Clear Logs", "Refresh", "Exit"]
        : ["Start Auto Daily Activity", "Set Manual Config", "Clear Logs", "Refresh", "Exit"]
    );
    safeRender();
  } catch (error) {
    addLog(`Menu update failed: ${error.message}`, "error");
  }
}

const statusInterval = setInterval(updateStatus, 100);

logBox.key(["up"], () => {
  if (screen.focused === logBox) {
    logBox.scroll(-1);
    safeRender();
  }
});

logBox.key(["down"], () => {
  if (screen.focused === logBox) {
    logBox.scroll(1);
    safeRender();
  }
});

logBox.on("click", () => {
  screen.focusPush(logBox);
  logBox.style.border.fg = "yellow";
  menuBox.style.border.fg = "red";
  dailyActivitySubMenu.style.border.fg = "blue";
  safeRender();
});

logBox.on("blur", () => {
  logBox.style.border.fg = "magenta";
  safeRender();
});

menuBox.on("select", async (item) => {
  const action = item.getText();
  switch (action) {
    case "Start Auto Daily Activity":
      if (isCycleRunning) {
        addLog("Cycle is still running. Stop the current cycle first.", "error");
      } else {
        await runDailyActivity();
      }
      break;
    case "Stop Activity":
      shouldStop = true;
      if (dailyActivityInterval) {
        clearTimeout(dailyActivityInterval);
        dailyActivityInterval = null;
        addLog("Cleared daily activity interval.", "info");
      }
      addLog("Stopping daily activity. Please wait for ongoing process to complete.", "info");
      safeRender();
      if (activeProcesses <= 0) {
        activityRunning = false;
        isCycleRunning = false;
        shouldStop = false;
        hasLoggedSleepInterrupt = false;
        addLog("Daily activity stopped successfully.", "success");
        updateMenu();
        updateStatus();
        safeRender();
      } else {
        const stopCheckInterval = setInterval(() => {
          if (activeProcesses <= 0) {
            clearInterval(stopCheckInterval);
            activityRunning = false;
            isCycleRunning = false;
            shouldStop = false;
            hasLoggedSleepInterrupt = false;
            activeProcesses = 0;
            addLog("Daily activity stopped successfully.", "success");
            updateMenu();
            updateStatus();
            safeRender();
          } else {
            addLog(`Waiting for ${activeProcesses} process(es) to complete...`, "info");
            safeRender();
          }
        }, 1000);
      }
      break;
    case "Set Manual Config":
      menuBox.hide();
      dailyActivitySubMenu.show();
      setTimeout(() => {
        if (dailyActivitySubMenu.visible) {
          screen.focusPush(dailyActivitySubMenu);
          dailyActivitySubMenu.style.border.fg = "yellow";
          logBox.style.border.fg = "magenta";
          safeRender();
        }
      }, 100);
      break;
    case "Clear Logs":
      clearTransactionLogs();
      break;
    case "Refresh":
      await updateWallets();
      addLog("Data refreshed.", "success");
      break;
    case "Exit":
      clearInterval(statusInterval);
      process.exit(0);
  }
});

dailyActivitySubMenu.on("select", (item) => {
  const action = item.getText();
  switch (action) {
    case "Set Swap Repetitions":
      configForm.configType = "swapRepetitions";
      configForm.setLabel(" Enter Swap Repetitions ");
      minLabel.hide();
      maxLabel.hide();
      configInput.setValue(dailyActivityConfig.swapRepetitions.toString());
      configInputMax.setValue("");
      configInputMax.hide();
      configForm.show();
      setTimeout(() => {
        if (configForm.visible) {
          screen.focusPush(configInput);
          configInput.clearValue();
          safeRender();
        }
      }, 100);
      break;
    case "Set Stake Repetitions":
      configForm.configType = "stakeRepetitions";
      configForm.setLabel(" Enter Stake Repetitions ");
      minLabel.hide();
      maxLabel.hide();
      configInput.setValue(dailyActivityConfig.stakeRepetitions.toString());
      configInputMax.setValue("");
      configInputMax.hide();
      configForm.show();
      setTimeout(() => {
        if (configForm.visible) {
          screen.focusPush(configInput);
          configInput.clearValue();
          safeRender();
        }
      }, 100);
      break;
    case "Set Unstake Repetitions": 
      configForm.configType = "unstakeRepetitions";
      configForm.setLabel(" Enter Unstake Repetitions ");
      minLabel.hide();
      maxLabel.hide();
      configInput.setValue(dailyActivityConfig.unstakeRepetitions.toString());
      configInputMax.setValue("");
      configInputMax.hide();
      configForm.show();
      setTimeout(() => {
        if (configForm.visible) {
          screen.focusPush(configInput);
          configInput.clearValue();
          safeRender();
        }
      }, 100);
      break;
    case "Set USDC Swap Range":
      configForm.configType = "usdcSwapRange";
      configForm.setLabel(" Enter USDC Swap Range ");
      minLabel.show();
      maxLabel.show();
      configInput.setValue(dailyActivityConfig.usdcSwapRange.min.toString());
      configInputMax.setValue(dailyActivityConfig.usdcSwapRange.max.toString());
      configInputMax.show();
      configForm.show();
      setTimeout(() => {
        if (configForm.visible) {
          screen.focusPush(configInput);
          configInput.clearValue();
          safeRender();
        }
      }, 100);
      break;
    case "Set GUSD Swap Range":
      configForm.configType = "gusdSwapRange";
      configForm.setLabel(" Enter GUSD Swap Range ");
      minLabel.show();
      maxLabel.show();
      configInput.setValue(dailyActivityConfig.gusdSwapRange.min.toString());
      configInputMax.setValue(dailyActivityConfig.gusdSwapRange.max.toString());
      configInputMax.show();
      configForm.show();
      setTimeout(() => {
        if (configForm.visible) {
          screen.focusPush(configInput);
          configInput.clearValue();
          safeRender();
        }
      }, 100);
      break;
    case "Set XAUM Stake Range":
      configForm.configType = "xaumStakeRange";
      configForm.setLabel(" Enter XAUM Stake Range ");
      minLabel.show();
      maxLabel.show();
      configInput.setValue(dailyActivityConfig.xaumStakeRange.min.toString());
      configInputMax.setValue(dailyActivityConfig.xaumStakeRange.max.toString());
      configInputMax.show();
      configForm.show();
      setTimeout(() => {
        if (configForm.visible) {
          screen.focusPush(configInput);
          configInput.clearValue();
          safeRender();
        }
      }, 100);
      break;
    case "Set XAUM Unstake Range": 
      configForm.configType = "xaumUnstakeRange";
      configForm.setLabel(" Enter XAUM Unstake Range ");
      minLabel.show();
      maxLabel.show();
      configInput.setValue(dailyActivityConfig.xaumUnstakeRange.min.toString());
      configInputMax.setValue(dailyActivityConfig.xaumUnstakeRange.max.toString());
      configInputMax.show();
      configForm.show();
      setTimeout(() => {
        if (configForm.visible) {
          screen.focusPush(configInput);
          configInput.clearValue();
          safeRender();
        }
      }, 100);
      break;
    case "Set Loop Daily":
      configForm.configType = "loopHours";
      configForm.setLabel(" Enter Loop Hours (Min 1 Hours) ");
      minLabel.hide();
      maxLabel.hide();
      configInput.setValue(dailyActivityConfig.loopHours.toString());
      configInputMax.setValue("");
      configInputMax.hide();
      configForm.show();
      setTimeout(() => {
        if (configForm.visible) {
          screen.focusPush(configInput);
          configInput.clearValue();
          safeRender();
        }
      }, 100);
      break;
    case "Back to Main Menu":
      dailyActivitySubMenu.hide();
      menuBox.show();
      setTimeout(() => {
        if (menuBox.visible) {
          screen.focusPush(menuBox);
          menuBox.style.border.fg = "cyan";
          dailyActivitySubMenu.style.border.fg = "blue";
          logBox.style.border.fg = "magenta";
          safeRender();
        }
      }, 100);
      break;
  }
});

let isSubmitting = false;
configForm.on("submit", () => {
  if (isSubmitting) return;
  isSubmitting = true;

  const inputValue = configInput.getValue().trim();
  let value, maxValue;
  try {
    if (configForm.configType === "loopHours" || configForm.configType === "swapRepetitions" || configForm.configType === "stakeRepetitions" || configForm.configType === "unstakeRepetitions") {
      value = parseInt(inputValue);
    } else {
      value = parseFloat(inputValue);
    }
    if (["usdcSwapRange", "gusdSwapRange", "xaumStakeRange", "xaumUnstakeRange"].includes(configForm.configType)) {
      maxValue = parseFloat(configInputMax.getValue().trim());
      if (isNaN(maxValue) || maxValue <= 0) {
        addLog("Invalid Max value. Please enter a positive number.", "error");
        configInputMax.clearValue();
        screen.focusPush(configInputMax);
        safeRender();
        isSubmitting = false;
        return;
      }
    }
    if (isNaN(value) || value <= 0) {
      addLog("Invalid input. Please enter a positive number.", "error");
      configInput.clearValue();
      screen.focusPush(configInput);
      safeRender();
      isSubmitting = false;
      return;
    }
    if (configForm.configType === "loopHours" && value < 1) {
      addLog("Invalid input. Minimum is 1 hour.", "error");
      configInput.clearValue();
      screen.focusPush(configInput);
      safeRender();
      isSubmitting = false;
      return;
    }
  } catch (error) {
    addLog(`Invalid format: ${error.message}`, "error");
    configInput.clearValue();
    screen.focusPush(configInput);
    safeRender();
    isSubmitting = false;
    return;
  }

  if (configForm.configType === "swapRepetitions") {
    dailyActivityConfig.swapRepetitions = Math.floor(value);
    addLog(`Swap Repetitions set to ${dailyActivityConfig.swapRepetitions}`, "success");
  } else if (configForm.configType === "stakeRepetitions") {
    dailyActivityConfig.stakeRepetitions = Math.floor(value);
    addLog(`Stake Repetitions set to ${dailyActivityConfig.stakeRepetitions}`, "success");
  } else if (configForm.configType === "unstakeRepetitions") { 
    dailyActivityConfig.unstakeRepetitions = Math.floor(value);
    addLog(`Unstake Repetitions set to ${dailyActivityConfig.unstakeRepetitions}`, "success");
  } else if (configForm.configType === "usdcSwapRange") {
    if (value > maxValue) {
      addLog("Min value cannot be greater than Max value.", "error");
      configInput.clearValue();
      configInputMax.clearValue();
      screen.focusPush(configInput);
      safeRender();
      isSubmitting = false;
      return;
    }
    dailyActivityConfig.usdcSwapRange.min = value;
    dailyActivityConfig.usdcSwapRange.max = maxValue;
    addLog(`USDC Swap Range set to ${value} - ${maxValue}`, "success");
  } else if (configForm.configType === "gusdSwapRange") {
    if (value > maxValue) {
      addLog("Min value cannot be greater than Max value.", "error");
      configInput.clearValue();
      configInputMax.clearValue();
      screen.focusPush(configInput);
      safeRender();
      isSubmitting = false;
      return;
    }
    dailyActivityConfig.gusdSwapRange.min = value;
    dailyActivityConfig.gusdSwapRange.max = maxValue;
    addLog(`GUSD Swap Range set to ${value} - ${maxValue}`, "success");
  } else if (configForm.configType === "xaumStakeRange") {
    if (value > maxValue) {
      addLog("Min value cannot be greater than Max value.", "error");
      configInput.clearValue();
      configInputMax.clearValue();
      screen.focusPush(configInput);
      safeRender();
      isSubmitting = false;
      return;
    }
    dailyActivityConfig.xaumStakeRange.min = value;
    dailyActivityConfig.xaumStakeRange.max = maxValue;
    addLog(`XAUM Stake Range set to ${value} - ${maxValue}`, "success");
  } else if (configForm.configType === "xaumUnstakeRange") { 
    if (value > maxValue) {
      addLog("Min value cannot be greater than Max value.", "error");
      configInput.clearValue();
      configInputMax.clearValue();
      screen.focusPush(configInput);
      safeRender();
      isSubmitting = false;
      return;
    }
    dailyActivityConfig.xaumUnstakeRange.min = value;
    dailyActivityConfig.xaumUnstakeRange.max = maxValue;
    addLog(`XAUM Unstake Range set to ${value} - ${maxValue}`, "success");
  } else if (configForm.configType === "loopHours") {
    dailyActivityConfig.loopHours = value;
    addLog(`Loop Daily set to ${value} hours`, "success");
  }
  saveConfig();
  updateStatus();

  configForm.hide();
  dailyActivitySubMenu.show();
  setTimeout(() => {
    if (dailyActivitySubMenu.visible) {
      screen.focusPush(dailyActivitySubMenu);
      dailyActivitySubMenu.style.border.fg = "yellow";
      logBox.style.border.fg = "magenta";
      safeRender();
    }
    isSubmitting = false;
  }, 100);
});

configInput.key(["enter"], () => {
  if (["usdcSwapRange", "gusdSwapRange", "xaumStakeRange", "xaumUnstakeRange"].includes(configForm.configType)) {
    screen.focusPush(configInputMax);
  } else {
    configForm.submit();
  }
});

configInputMax.key(["enter"], () => {
  configForm.submit();
});

configSubmitButton.on("press", () => {
  configForm.submit();
});

configSubmitButton.on("click", () => {
  screen.focusPush(configSubmitButton);
  configForm.submit();
});

configForm.key(["escape"], () => {
  configForm.hide();
  dailyActivitySubMenu.show();
  setTimeout(() => {
    if (dailyActivitySubMenu.visible) {
      screen.focusPush(dailyActivitySubMenu);
      dailyActivitySubMenu.style.border.fg = "yellow";
      logBox.style.border.fg = "magenta";
      safeRender();
    }
  }, 100);
});

dailyActivitySubMenu.key(["escape"], () => {
  dailyActivitySubMenu.hide();
  menuBox.show();
  setTimeout(() => {
    if (menuBox.visible) {
      screen.focusPush(menuBox);
      menuBox.style.border.fg = "cyan";
      dailyActivitySubMenu.style.border.fg = "blue";
      logBox.style.border.fg = "magenta";
      safeRender();
    }
  }, 100);
});

screen.key(["escape", "q", "C-c"], () => {
  addLog("Exiting application", "info");
  clearInterval(statusInterval);
  process.exit(0);
});

async function initialize() {
  try {
    loadConfig();
    loadAccounts();
    loadProxies();
    updateStatus();
    await updateWallets();
    updateLogs();
    safeRender();
    menuBox.focus();
  } catch (error) {
    addLog(`Initialization error: ${error.message}`, "error");
  }
}

setTimeout(() => {
  adjustLayout();
  screen.on("resize", adjustLayout);
}, 100);

initialize();