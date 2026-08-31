const App = {
  web3: null,
  account: null,
  escrowContract: null,
  tokenContract: null,

  init: async function () {
    if (window.ethereum) {
      this.web3 = new Web3(window.ethereum);
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length > 0) {
          App.account = accounts[0];
          App.refreshUI();
        } else {
          location.reload();
        }
      });
      window.ethereum.on("chainChanged", () => {
        location.reload();
      });
    }
  },

  connectWallet: async function () {
    if (!window.ethereum) return alert("Please install MetaMask!");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      this.account = accounts[0];

      const escrowArtifact = await (await fetch("/build/contracts/LogisticsEscrow.json")).json();
      const tokenArtifact = await (await fetch("/build/contracts/CarrierReputationToken.json")).json();
      const networkId = await this.web3.eth.net.getId();

      let deployedEscrow = escrowArtifact.networks[networkId];
      let deployedToken = tokenArtifact.networks[networkId];

      if (!deployedEscrow || !deployedToken) {
        const escrowKeys = Object.keys(escrowArtifact.networks || {});
        const tokenKeys = Object.keys(tokenArtifact.networks || {});
        if (escrowKeys.length > 0 && tokenKeys.length > 0) {
          deployedEscrow = escrowArtifact.networks[escrowKeys[escrowKeys.length - 1]];
          deployedToken = tokenArtifact.networks[tokenKeys[tokenKeys.length - 1]];
        }
      }

      if (!deployedEscrow || !deployedToken) {
        return alert("Contracts not deployed on network ID " + networkId + "! Please run 'npx truffle migrate --reset'.");
      }

      const code = await this.web3.eth.getCode(deployedEscrow.address);
      if (!code || code === "0x" || code === "0x0") {
        return alert("No contract code found at " + deployedEscrow.address + " on this blockchain. Did you restart Ganache? Please run 'npx truffle migrate --reset' and refresh!");
      }

      this.escrowContract = new this.web3.eth.Contract(escrowArtifact.abi, deployedEscrow.address);
      this.tokenContract = new this.web3.eth.Contract(tokenArtifact.abi, deployedToken.address);

      await this.refreshUI();
    } catch (err) {
      console.error("Connection error:", err);
      alert("Failed to connect wallet: " + (err.message || err));
    }
  },

  calculateEstimate: function () {
    const dist = parseFloat(document.getElementById("calcDistance").value) || 0;
    const weight = parseFloat(document.getElementById("calcWeight").value) || 0;
    const est = 0.01 + (dist * 0.0005) + (weight * 0.0002);
    document.getElementById("createEthValue").value = est.toFixed(4);
  },

  refreshUI: async function () {
    if (!this.account || !this.escrowContract) return;

    const badge = document.getElementById("accountBadge");
    badge.classList.remove("d-none");
    badge.innerText = `${this.account.substring(0, 6)}...${this.account.substring(38)}`;
    document.getElementById("connectWalletBtn").classList.add("d-none");

    const user = await this.escrowContract.methods.users(this.account).call();
    const roleBadge = document.getElementById("roleBadge");
    const repBadge = document.getElementById("reputationBadge");
    const regPanel = document.getElementById("registrationPanel");
    const shipperPanel = document.getElementById("shipperCreatePanel");

    roleBadge.classList.remove("d-none");

    if (!user.isRegistered) {
      roleBadge.className = "badge bg-secondary py-2 px-3";
      roleBadge.innerText = "Unregistered";
      regPanel.classList.remove("d-none");
      shipperPanel.classList.add("d-none");
      if (repBadge) repBadge.classList.add("d-none");
    } else {
      regPanel.classList.add("d-none");
      const roleName = user.role == "1" ? "Shipper" : "Carrier";
      roleBadge.className = user.role == "1" ? "badge bg-info text-dark py-2 px-3" : "badge bg-primary py-2 px-3";
      roleBadge.innerText = `Role: ${roleName} (${user.name})`;

      if (user.role == "1") {
        shipperPanel.classList.remove("d-none");
        this.calculateEstimate();
        if (repBadge) repBadge.classList.add("d-none");
      } else {
        shipperPanel.classList.add("d-none");
        const rep = await this.tokenContract.methods.balanceOf(this.account).call();
        if (repBadge) {
          repBadge.classList.remove("d-none");
          let tier = "🥉 Bronze";
          if (parseInt(rep) >= 1000) tier = "🥇 Gold";
          else if (parseInt(rep) >= 300) tier = "🥈 Silver";
          repBadge.innerText = `${tier} (${rep} CRT)`;
        }
      }
    }

    await this.loadAgreements();
  },

  registerUser: async function () {
    const name = document.getElementById("regName").value.trim();
    const role = document.getElementById("regRole").value;
    if (!name) return alert("Please enter your name!");
    try {
      await this.escrowContract.methods.registerUser(name, role).send({ from: this.account });
      alert("Registration successful!");
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Registration failed: " + (err.message || err));
    }
  },

  createAgreement: async function () {
    const carrier = document.getElementById("createCarrierAddr").value.trim();
    const ethVal = document.getElementById("createEthValue").value.trim();
    const minutes = document.getElementById("createDeadlineMinutes").value.trim();

    if (!carrier || !this.web3.utils.isAddress(carrier)) return alert("Please enter a valid Carrier Ethereum address!");
    if (!ethVal || parseFloat(ethVal) <= 0) return alert("Please enter a valid ETH payload amount!");
    if (!minutes || parseInt(minutes) <= 0) return alert("Please enter a valid deadline in minutes!");

    try {
      const deadline = Math.floor(Date.now() / 1000) + parseInt(minutes) * 60;
      const weiVal = this.web3.utils.toWei(ethVal, "ether");

      await this.escrowContract.methods.createAgreement(carrier, deadline).send({
        from: this.account,
        value: weiVal
      });
      alert("Agreement created and escrow funded successfully!");
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Create agreement failed: " + (err.message || err));
    }
  },

  loadAgreements: async function () {
    if (!this.escrowContract) return;
    try {
      const total = await this.escrowContract.methods.totalAgreements().call();
      const owner = await this.escrowContract.methods.owner().call();
      const arbiter = await this.escrowContract.methods.arbiter().call();
      const tbody = document.getElementById("agreementTableBody");
      tbody.innerHTML = "";

      if (parseInt(total) === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No freight agreements found. Create one above!</td></tr>`;
        return;
      }

      const statusNames = ["Created", "InTransit", "Delivering", "Completed", "Refunded", "Disputed", "Cancelled"];
      const statusBadges = [
        "bg-secondary",
        "bg-info text-dark",
        "bg-primary",
        "bg-success",
        "bg-danger",
        "bg-warning text-dark",
        "bg-dark border border-secondary"
      ];

      for (let i = 1; i <= parseInt(total); i++) {
        const ag = await this.escrowContract.methods.getAgreementDetails(i).call();
        const ms1 = await this.escrowContract.methods.getMilestoneDetails(i, 0).call();
        const ms2 = await this.escrowContract.methods.getMilestoneDetails(i, 1).call();

        const isCarrier = this.account.toLowerCase() === ag.carrier.toLowerCase();
        const isShipper = this.account.toLowerCase() === ag.shipper.toLowerCase();
        const isArbiter = this.account.toLowerCase() === arbiter.toLowerCase() || this.account.toLowerCase() === owner.toLowerCase();
        const now = Math.floor(Date.now() / 1000);
        const isOverdue = now > parseInt(ag.deadline);

        let actionHtml = "";
        const statusIdx = parseInt(ag.status);

        // Carrier Actions
        if (isCarrier) {
          if (!ms1.completed && statusIdx === 1) {
            actionHtml += `<button class="btn btn-sm btn-info me-1 my-1" onclick="App.submitMilestone(${ag.id}, 0)">🚚 Pickup</button>`;
          }
          if (ms1.approved && !ms2.completed && statusIdx === 2) {
            actionHtml += `<button class="btn btn-sm btn-success me-1 my-1" onclick="App.submitMilestone(${ag.id}, 1)">📦 Deliver</button>`;
          }
        }

        // Shipper Actions
        if (isShipper) {
          if (!ms1.completed && statusIdx === 1) {
            actionHtml += `<button class="btn btn-sm btn-outline-secondary me-1 my-1" onclick="App.cancelAgreement(${ag.id})">❌ Cancel</button>`;
          }
          if (ms1.completed && !ms1.approved && statusIdx === 1) {
            actionHtml += `<button class="btn btn-sm btn-primary me-1 my-1" onclick="App.approveMilestone(${ag.id}, 0)">✅ Approve 30%</button>`;
          }
          if (ms2.completed && !ms2.approved && statusIdx === 2) {
            actionHtml += `<button class="btn btn-sm btn-success me-1 my-1" onclick="App.approveMilestone(${ag.id}, 1)">✅ Approve 70%</button>`;
            actionHtml += `<button class="btn btn-sm btn-warning me-1 my-1" onclick="App.raiseDispute(${ag.id})">⚠️ Dispute</button>`;
          }
          if (isOverdue && statusIdx !== 3 && statusIdx !== 4 && statusIdx !== 6 && BigInt(ag.remainingBalance) > 0n) {
            actionHtml += `<button class="btn btn-sm btn-danger me-1 my-1" onclick="App.claimRefund(${ag.id})">⏰ Timeout Refund</button>`;
          }
        }

        // Arbiter Actions
        if (isArbiter && statusIdx === 5) {
          actionHtml += `<button class="btn btn-sm btn-warning me-1 my-1" onclick="App.resolveDispute(${ag.id})">⚖️ Mediate</button>`;
        }

        if (!actionHtml) {
          actionHtml = `<span class="text-muted small">No action required</span>`;
        }

        const totalEth = this.web3.utils.fromWei(ag.totalValue, "ether");
        const remainingEth = this.web3.utils.fromWei(ag.remainingBalance, "ether");
        const deadlineDate = new Date(parseInt(ag.deadline) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const deadlineDisplay = isOverdue ? `<span class="text-danger fw-bold">${deadlineDate} (Expired)</span>` : `<span class="text-success">${deadlineDate}</span>`;

        tbody.innerHTML += `
          <tr>
            <td class="fw-bold">#${ag.id}</td>
            <td><code>${ag.shipper.substring(0, 6)}...${ag.shipper.substring(38)}</code></td>
            <td><code>${ag.carrier.substring(0, 6)}...${ag.carrier.substring(38)}</code></td>
            <td>${parseFloat(totalEth).toFixed(3)} ETH</td>
            <td>${parseFloat(remainingEth).toFixed(3)} ETH</td>
            <td>${deadlineDisplay}</td>
            <td><span class="badge ${statusBadges[statusIdx] || 'bg-secondary'}">${statusNames[statusIdx] || 'Unknown'}</span></td>
            <td>${actionHtml}</td>
          </tr>
        `;
      }
    } catch (err) {
      console.error("Error loading agreements:", err);
    }
  },

  submitMilestone: async function (id, msIndex) {
    const proof = prompt("Enter IPFS Proof CID or Bill of Lading Hash:", "QmDemoCargoProof" + Date.now());
    if (proof === null) return;
    try {
      await this.escrowContract.methods.submitMilestoneProof(id, msIndex, proof || "N/A").send({ from: this.account });
      alert("Milestone " + (msIndex + 1) + " proof submitted successfully!");
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Milestone submission failed: " + (err.message || err));
    }
  },

  approveMilestone: async function (id, msIndex) {
    const confirmMsg = msIndex === 0 ? "Approve Milestone 1 and release 30% ETH payout to Carrier?" : "Approve Milestone 2 and release remaining 70% ETH payout to Carrier?";
    if (!confirm(confirmMsg)) return;
    try {
      await this.escrowContract.methods.approveMilestonePayout(id, msIndex).send({ from: this.account });
      alert("Milestone " + (msIndex + 1) + " approved and ETH funds released!");
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Approval failed: " + (err.message || err));
    }
  },

  cancelAgreement: async function (id) {
    if (!confirm("Cancel agreement #" + id + " and receive a 100% escrow refund?")) return;
    try {
      await this.escrowContract.methods.cancelBeforePickup(id).send({ from: this.account });
      alert("Agreement cancelled and full escrow refunded!");
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Cancellation failed: " + (err.message || err));
    }
  },

  raiseDispute: async function (id) {
    const reason = prompt("Enter Dispute Reason (e.g. Damaged Goods, Missing Items):", "Cargo arrived damaged during transit");
    if (!reason) return;
    try {
      await this.escrowContract.methods.raiseDispute(id, reason).send({ from: this.account });
      alert("Dispute raised. Escrow frozen for arbiter review.");
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Raise dispute failed: " + (err.message || err));
    }
  },

  claimRefund: async function (id) {
    if (!confirm("Claim timeout refund for agreement #" + id + "? (Carrier reputation will be slashed)")) return;
    try {
      await this.escrowContract.methods.claimTimeoutRefund(id).send({ from: this.account });
      alert("Timeout refund claimed successfully!");
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Claim refund failed: " + (err.message || err));
    }
  },

  resolveDispute: async function (id) {
    const shipperPct = prompt("Enter Shipper Refund % (0 to 100):", "50");
    if (shipperPct === null) return;
    const carrierPct = 100 - parseInt(shipperPct);
    const slashStake = confirm("Slash Carrier Staked Deposit as compensation penalty?");
    const slashAmountWei = slashStake ? this.web3.utils.toWei("0.05", "ether") : "0";

    try {
      await this.escrowContract.methods.resolveDispute(id, parseInt(shipperPct), carrierPct, slashStake, slashAmountWei).send({ from: this.account });
      alert("Dispute resolved successfully!");
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Resolve dispute failed: " + (err.message || err));
    }
  }
};

window.addEventListener("load", () => App.init());
