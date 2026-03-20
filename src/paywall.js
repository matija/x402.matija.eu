const NETWORK_NAMES = {
  'eip155:137': 'Polygon',
  'eip155:8453': 'Base',
  'eip155:84532': 'Base Sepolia',
  'eip155:1': 'Ethereum',
};

function networkName(id) {
  return NETWORK_NAMES[id] || id;
}

function chainId(network) {
  return parseInt(network.split(':')[1], 10);
}

function formatAmount(atomic, decimals = 6) {
  const s = atomic.padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals) || '0';
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const manPagePaywall = {
  generateHtml(paymentRequired) {
    const req = paymentRequired.accepts[0] || {};
    const url = paymentRequired.resource?.url || '';
    const desc = paymentRequired.resource?.description || '';
    const path = url ? new URL(url).pathname : '???';
    const network = esc(networkName(req.network));
    const cId = chainId(req.network);
    const amount = req.amount || '0';
    const amountFmt = formatAmount(amount);
    const token = req.extra?.name || 'USDC';
    const tokenVersion = req.extra?.version || '2';
    const asset = req.asset || '';
    const payTo = req.payTo || '';
    const timeout = req.maxTimeoutSeconds || 300;
    const prJson = JSON.stringify(paymentRequired);

    return /* html */ `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay ${amountFmt} ${esc(token)} — x402</title>
<style>
  * { box-sizing: border-box }
  body {
    max-width: 72ch; margin: 2rem auto; padding: 0 1rem;
    font: 14px/1.6 monospace; color: #111; background: #fff;
  }
  a { color: #2563eb }
  h1, h2 { font-size: 14px; font-weight: bold; margin: 1.5em 0 0 }
  pre { margin: 0; white-space: pre-wrap; word-break: break-all }
  .t { color: #b91c1c }
  .d { color: #666 }
  .ok { color: #15803d }
  button {
    font: inherit; background: none; color: #2563eb;
    border: none; padding: 0; cursor: pointer; text-decoration: underline;
  }
  button:hover { color: #1d4ed8 }
  button:disabled { color: #93c5fd; cursor: wait; text-decoration: none }
  #wallets { display: none; margin: .3em 0 }
  #wallets a { margin-right: 1.5em }
  @media (max-width: 480px) { body { font-size: 12px; padding: 0 .5rem } }
</style>

<pre>
<h1>Payment Required</h1>
<h2>RESOURCE</h2>
    <a href="${esc(url)}">${esc(path)}</a>  ${esc(desc)}
    ${amountFmt} ${esc(token)} on ${network}

<h2>PAY</h2>
    <button id="btn" onclick="pay()">Pay with wallet</button>
    <span id="s"></span>
    <span id="hint" class="d" style="display:none">
    Your wallet will show a signature request with technical details
    (EIP-712 / TransferWithAuthorization). This authorises a ${amountFmt} ${esc(token)}
    transfer — no gas fee, no token approval.</span>
    <span id="wallets">
    Open in:
      <a id="wl-mm" href="#">MetaMask</a>
      <a id="wl-rb" href="#">Rainbow</a>
      <a id="wl-ry" href="#" title="Opens app; paste URL in built-in browser">Rabby</a>
      <a id="wl-ph" href="#">Phantom</a>
    </span>

<h2>SEE ALSO</h2>
    <a href="/">/</a>  <a href="/payment-info">/payment-info</a>  <a href="https://docs.x402.org">docs.x402.org</a>
</pre>

<script>
(function () {
  var C  = ${cId},
      CH = "0x" + C.toString(16),
      A  = "${asset}",
      T  = "${payTo}",
      V  = "${amount}",
      TN = ${JSON.stringify(token)},
      TV = ${JSON.stringify(tokenVersion)},
      TO = ${timeout},
      U  = ${JSON.stringify(url)},
      PR = ${prJson},
      N  = ${JSON.stringify(network)};

  var s  = document.getElementById("s"),
      b  = document.getElementById("btn"),
      wl = document.getElementById("wallets"),
      hi = document.getElementById("hint");

  var mob = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (mob && !window.ethereum) {
    wl.style.display = "block";
    var pg = location.host + location.pathname + location.search;
    document.getElementById("wl-mm").href =
      "https://metamask.app.link/dapp/" + pg;
    document.getElementById("wl-rb").href =
      "https://rnbwapp.com/dapp?url=" + encodeURIComponent(location.href);
    document.getElementById("wl-ry").href =
      "rabby://" + encodeURIComponent(location.href);
    document.getElementById("wl-ph").href =
      "https://phantom.app/ul/browse/" + encodeURIComponent(location.href) +
      "?ref=" + encodeURIComponent(location.origin);
  }

  function st(m, c) {
    s.className = c || "";
    s.textContent = "    " + m;
  }

  function rh() {
    var b = new Uint8Array(32);
    crypto.getRandomValues(b);
    return "0x" + Array.from(b, function (x) {
      return x.toString(16).padStart(2, "0");
    }).join("");
  }

  function b64(str) {
    var b = new TextEncoder().encode(str), r = "";
    for (var i = 0; i < b.length; i++) r += String.fromCharCode(b[i]);
    return btoa(r);
  }

  window.pay = async function () {
    if (!window.ethereum) {
      st("No wallet detected.", "t");
      if (mob) wl.style.display = "block";
      return;
    }

    b.disabled = true;
    st("Connecting...");

    try {
      var ac = await ethereum.request({ method: "eth_requestAccounts" });
      var f = ac[0];
      st("Connected: " + f.slice(0, 6) + "..." + f.slice(-4));

      var cc = await ethereum.request({ method: "eth_chainId" });
      if (parseInt(cc, 16) !== C) {
        st("Switching to " + N + "...");
        try {
          await ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CH }],
          });
        } catch (e) {
          if (e.code === 4902)
            throw new Error("Add " + N + " to your wallet first.");
          throw e;
        }
      }

      st("Approve the ${amountFmt} " + TN + " payment in your wallet...");
      hi.style.display = "block";

      var now = Math.floor(Date.now() / 1000);
      var n = rh();
      var az = {
        from: f, to: T, value: V,
        validAfter: String(now - 600),
        validBefore: String(now + TO),
        nonce: n,
      };

      var typedData = {
        types: {
          EIP712Domain: [
            { name: "name",              type: "string"  },
            { name: "version",           type: "string"  },
            { name: "chainId",           type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          TransferWithAuthorization: [
            { name: "from",        type: "address" },
            { name: "to",          type: "address" },
            { name: "value",       type: "uint256" },
            { name: "validAfter",  type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce",       type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        domain: { name: TN, version: TV, chainId: C, verifyingContract: A },
        message: az,
      };

      var sig = await ethereum.request({
        method: "eth_signTypedData_v4",
        params: [f, JSON.stringify(typedData)],
      });

      hi.style.display = "none";
      st("Submitting...");

      var pp = {
        x402Version: 2,
        payload: { authorization: az, signature: sig },
        resource: PR.resource,
        accepted: PR.accepts[0],
      };

      var r = await fetch(U, {
        headers: { "PAYMENT-SIGNATURE": b64(JSON.stringify(pp)) },
      });

      if (r.ok) {
        st("Paid!", "ok");
        var d = await r.text();
        try { d = JSON.stringify(JSON.parse(d), null, 2); } catch (e) {}
        var p = document.createElement("pre");
        p.style.cssText = "background:#f3f4f6;padding:1em;margin-top:.5em;overflow-x:auto";
        p.textContent = d;
        b.parentNode.appendChild(p);
        b.style.display = "none";
      } else if (r.status === 402) {
        st("Not accepted. Try again.", "t");
        b.disabled = false;
      } else {
        st("Error " + r.status, "t");
        b.disabled = false;
      }
    } catch (e) {
      console.error(e);
      st(e.code === 4001 ? "Rejected." : "Error: " + (e.message || e), "t");
      b.disabled = false;
    }
  };
})();
</script>`;
  },
};
