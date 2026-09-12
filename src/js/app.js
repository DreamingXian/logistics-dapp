const App = {
  web3: null,
  account: null,
  escrowContract: null,
  tokenContract: null,
  activeRole: null, // 1 = Shipper, 2 = Carrier, 'admin' = Platform Administrator
  ethToMyrRate: 13500, // 1 ETH ≈ RM 13,500
  allAgreements: [],
  shipperFilter: "ALL",
  shipperSort: "newest",
  shipperSearchTerm: "",
  carrierFilter: "ALL",
  carrierSort: "urgency",
  isCreatePanelOpen: false,
  currentTab: null,

  // 3-Map Leaflet State
  originMap: null,
  destMap: null,
  routeOverviewMap: null,
  originMarker: null,
  destMarker: null,
  overviewOriginMarker: null,
  overviewDestMarker: null,
  overviewRouteLine: null,
  originCoords: null, // Start empty so form has no default pin
  destCoords: null,   // Start empty so form has no default pin
  activeDetailAgreementId: null,
  _expiredAgreementsNotified: new Set(),
  _activeLoadingButtons: new Set(),
  _currentTriggerBtn: null,
  _currentTriggerBtnHtml: "",

  showToast: function (title, message, type = "success", duration = 4500) {
    const container = document.getElementById("topNotificationContainer");
    if (!container) {
      console.log(`[Toast ${type}] ${title}: ${message}`);
      return;
    }

    const toast = document.createElement("div");
    toast.className = `top-toast toast-${type}`;

    let icon = "✅";
    if (type === "cancel" || type === "info") icon = "↩️";
    if (type === "error") icon = "❌";

    toast.innerHTML = `
      <div class="d-flex align-items-center gap-3">
        <span class="fs-4">${icon}</span>
        <div>
          <div class="fw-bold text-white small mb-0">${title}</div>
          <div class="text-light extra-small opacity-90">${message}</div>
        </div>
      </div>
      <button type="button" class="btn-close btn-close-white btn-sm ms-2" aria-label="Close"></button>
      <div class="top-toast-progress" style="animation-duration: ${duration}ms;"></div>
    `;

    container.appendChild(toast);

    let isDismissed = false;
    const dismiss = () => {
      if (isDismissed) return;
      isDismissed = true;
      toast.classList.add("toast-fadeout");
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    };

    const closeBtn = toast.querySelector(".btn-close");
    if (closeBtn) closeBtn.onclick = dismiss;

    setTimeout(dismiss, duration);
  },

  showFieldValidationError: function (fieldId, title, message) {
    this.showToast(title, message, "error", 5500);

    // Update dedicated banner in create form if present
    const alertEl = document.getElementById("createFormErrorAlert");
    const alertTitle = document.getElementById("createFormErrorTitle");
    const alertMsg = document.getElementById("createFormErrorMessage");
    if (alertEl) {
      if (alertTitle) alertTitle.innerText = title;
      if (alertMsg) alertMsg.innerText = message;
      alertEl.classList.remove("d-none");
      alertEl.classList.add("d-flex");
    }

    if (fieldId) {
      // Remove invalid class from previously highlighted fields
      document.querySelectorAll(".form-field-invalid").forEach(el => el.classList.remove("form-field-invalid"));

      const targetEl = document.getElementById(fieldId);
      if (targetEl) {
        targetEl.classList.add("form-field-invalid");
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          try {
            targetEl.focus();
          } catch (e) {}
        }, 150);

        const cleanUp = () => {
          targetEl.classList.remove("form-field-invalid");
          if (alertEl) {
            alertEl.classList.add("d-none");
            alertEl.classList.remove("d-flex");
          }
          targetEl.removeEventListener("input", cleanUp);
          targetEl.removeEventListener("change", cleanUp);
        };
        targetEl.addEventListener("input", cleanUp, { once: true });
        targetEl.addEventListener("change", cleanUp, { once: true });
      }
    }
    return false;
  },

  formatPercentAmount: function (totalWei, percent) {
    if (!totalWei) return `${percent}% (0.0000 ETH ≈ RM 0.00)`;
    try {
      const valBig = BigInt(totalWei);
      const partWei = (valBig * BigInt(percent)) / BigInt(100);
      const ethVal = parseFloat(this.web3 ? this.web3.utils.fromWei(partWei.toString(), "ether") : "0").toFixed(4);
      const myrVal = (parseFloat(ethVal) * this.ethToMyrRate).toFixed(2);
      return `${percent}% (${ethVal} ETH ≈ RM ${parseFloat(myrVal).toLocaleString()})`;
    } catch (e) {
      return `${percent}%`;
    }
  },

  formatPercentEthOnly: function (totalWei, percent) {
    if (!totalWei) return `${percent}% (0.0000 ETH)`;
    try {
      const valBig = BigInt(totalWei);
      const partWei = (valBig * BigInt(percent)) / BigInt(100);
      const ethVal = parseFloat(this.web3 ? this.web3.utils.fromWei(partWei.toString(), "ether") : "0").toFixed(4);
      return `${percent}% (${ethVal} ETH)`;
    } catch (e) {
      return `${percent}%`;
    }
  },

  showTxLoading: function (title, message, subtext, triggerBtn) {
    const overlay = document.getElementById("txLoadingOverlay");
    if (overlay) {
      const titleEl = document.getElementById("txLoadingTitle");
      const msgEl = document.getElementById("txLoadingMsg");
      const subEl = document.getElementById("txLoadingSub");
      if (titleEl) titleEl.innerText = title || "Processing Blockchain Transaction";
      if (msgEl) msgEl.innerText = message || "Please confirm the request in your Web3 wallet (MetaMask)...";
      if (subEl) subEl.innerText = subtext || "Awaiting cryptographic signature on local EVM ledger";
      overlay.style.display = "flex";
      overlay.classList.add("active");
    }

    if (triggerBtn) {
      if (typeof triggerBtn === "string") triggerBtn = document.getElementById(triggerBtn);
      if (triggerBtn && triggerBtn.nodeType === 1) {
        if (!triggerBtn._origHtml) {
          triggerBtn._origHtml = triggerBtn.innerHTML;
        }
        triggerBtn.disabled = true;
        triggerBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Processing...`;
        this._activeLoadingButtons.add(triggerBtn);
      }
    }
  },

  hideTxLoading: function (triggerBtn) {
    const overlay = document.getElementById("txLoadingOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.style.display = "none";
    }

    if (triggerBtn) {
      if (typeof triggerBtn === "string") triggerBtn = document.getElementById(triggerBtn);
      if (triggerBtn && triggerBtn.nodeType === 1) {
        this._activeLoadingButtons.add(triggerBtn);
      }
    }

    this._activeLoadingButtons.forEach(btn => {
      if (btn && btn.nodeType === 1) {
        if (btn._origHtml !== undefined) {
          btn.innerHTML = btn._origHtml;
          delete btn._origHtml;
        }
        btn.disabled = false;
      }
    });
    this._activeLoadingButtons.clear();
  },

  showConfirmDialog: function ({ title = "Confirm Action", icon = "⚠️", message = "", okText = "Confirm", cancelText = "Cancel", okBtnClass = "btn-primary" }) {
    return new Promise((resolve) => {
      const overlay = document.getElementById("customConfirmOverlay");
      if (!overlay) {
        return resolve(window.confirm(message));
      }

      const titleEl = document.getElementById("customConfirmTitle");
      const iconEl = document.getElementById("customConfirmIcon");
      const msgEl = document.getElementById("customConfirmMessage");
      const okBtn = document.getElementById("customConfirmOkBtn");
      const cancelBtn = document.getElementById("customConfirmCancelBtn");

      if (titleEl) titleEl.innerText = title;
      if (iconEl) iconEl.innerText = icon;
      if (msgEl) msgEl.innerText = message;

      if (okBtn) {
        okBtn.className = `btn ${okBtnClass} px-4 fw-bold shadow`;
        okBtn.innerText = okText;
      }
      if (cancelBtn) cancelBtn.innerText = cancelText;

      overlay.style.display = "flex";

      let settled = false;
      const cleanupAndResolve = (result) => {
        if (settled) return;
        settled = true;
        overlay.style.display = "none";
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        document.removeEventListener("keydown", onKeyDown);
        resolve(result);
      };

      const onKeyDown = (e) => {
        if (e.key === "Escape") cleanupAndResolve(false);
      };

      okBtn.onclick = () => cleanupAndResolve(true);
      cancelBtn.onclick = () => cleanupAndResolve(false);
      document.addEventListener("keydown", onKeyDown);
    });
  },

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

    this.switchTab("disconnected");
    // Form starts completely blank without preselected deadline

    const deadlineInput = document.getElementById("createExactDeadline");
    if (deadlineInput) {
      deadlineInput.addEventListener("click", function () {
        if (this.showPicker) {
          try { this.showPicker(); } catch (e) {}
        }
      });
      deadlineInput.addEventListener("focus", function () {
        if (this.showPicker) {
          try { this.showPicker(); } catch (e) {}
        }
      });
    }

    this.startDeadlineTicker();
  },

  onBrandClick: function () {
    if (this.activeRole === 1) {
      this.switchTab("shipper");
    } else if (this.activeRole === 2) {
      this.switchTab("carrier-profile");
    } else if (this.isArbiter) {
      this.switchTab("arbiter");
    } else {
      this.switchTab("disconnected");
    }
  },

  connectWallet: async function () {
    if (!window.ethereum) {
      return alert("MetaMask is not detected. Please install MetaMask to continue!");
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      this.account = accounts[0];

      const escrowArtifact = await (await fetch("/build/contracts/LogisticsEscrow.json")).json();
      const tokenArtifact = await (await fetch("/build/contracts/CarrierReputationToken.json")).json();
      const networkId = await this.web3.eth.net.getId();
      const chainId = await this.web3.eth.getChainId();

      // Update Network Indicator Badge
      const netBadge = document.getElementById("networkBadge");
      const netName = document.getElementById("networkName");
      netBadge.classList.remove("d-none");

      if (networkId == 5777 || chainId == 1337 || chainId == 5777) {
        netName.innerText = "Ganache Local (127.0.0.1:7545)";
        netBadge.className = "badge network-badge px-3 py-2 border-success text-success";
      } else if (chainId == 11155111 || networkId == 11155111) {
        netName.innerText = "Ethereum Sepolia Testnet";
        netBadge.className = "badge network-badge px-3 py-2 border-info text-info";
      } else {
        netName.innerText = `Network ID: ${networkId}`;
        netBadge.className = "badge network-badge px-3 py-2 border-warning text-warning";
      }

      // Match deployed network
      let deployedEscrow = escrowArtifact.networks[networkId] || escrowArtifact.networks[chainId];
      let deployedToken = tokenArtifact.networks[networkId] || tokenArtifact.networks[chainId];

      if (!deployedEscrow || !deployedToken) {
        const escrowKeys = Object.keys(escrowArtifact.networks || {});
        const tokenKeys = Object.keys(tokenArtifact.networks || {});
        if (escrowKeys.length > 0 && tokenKeys.length > 0) {
          deployedEscrow = escrowArtifact.networks[escrowKeys[escrowKeys.length - 1]];
          deployedToken = tokenArtifact.networks[tokenKeys[tokenKeys.length - 1]];
        }
      }

      if (!deployedEscrow || !deployedToken) {
        return alert("Contracts are not deployed on network ID " + networkId + "! Run 'npx truffle migrate --reset'.");
      }

      const code = await this.web3.eth.getCode(deployedEscrow.address);
      if (!code || code === "0x" || code === "0x0") {
        return alert("No contract bytecode found at " + deployedEscrow.address + ". Run 'npx truffle migrate --reset' and refresh!");
      }

      this.escrowContract = new this.web3.eth.Contract(escrowArtifact.abi, deployedEscrow.address);
      this.tokenContract = new this.web3.eth.Contract(tokenArtifact.abi, deployedToken.address);

      await this.refreshUI();
    } catch (err) {
      console.error("Wallet connection error:", err);
      alert("Failed to connect wallet: " + (err.message || err));
    }
  },

  refreshUI: async function () {
    if (!this.account || !this.escrowContract) return;

    // Show header badges
    const accountBadge = document.getElementById("accountBadge");
    accountBadge.classList.remove("d-none");
    accountBadge.innerText = `${this.account.substring(0, 6)}...${this.account.substring(38)}`;
    document.getElementById("connectWalletBtn").classList.add("d-none");
    document.getElementById("navTabsContainer").classList.remove("d-none");

    // Query on-chain user & authority state
    const user = await this.escrowContract.methods.users(this.account).call();
    const owner = await this.escrowContract.methods.owner().call();
    this.isAdmin = (this.account.toLowerCase() === owner.toLowerCase());

    const roleBadge = document.getElementById("roleBadge");
    const repBadge = document.getElementById("reputationBadge");
    roleBadge.classList.remove("d-none");

    const navPillsContainer = document.getElementById("mainNavPills");
    navPillsContainer.innerHTML = "";

    // CASE 1: UNREGISTERED ACCOUNT (and not Admin)
    if (!user.isRegistered && !this.isAdmin) {
      roleBadge.className = "badge bg-secondary px-3 py-2";
      roleBadge.innerText = "Unregistered Account";
      repBadge.classList.add("d-none");

      navPillsContainer.innerHTML = `
        <li class="nav-item">
          <button class="nav-link active" onclick="App.switchTab('register')">📝 Profile Registration</button>
        </li>
      `;

      this.switchTab("register");
      return;
    }

    // CASE 2: PLATFORM ADMINISTRATOR (Deployer / Auditor)
    if (this.isAdmin && !user.isRegistered) {
      this.activeRole = "admin";
      roleBadge.className = "badge bg-warning text-dark px-3 py-2 fw-bold";
      roleBadge.innerText = "👑 Platform Administrator (Auditor)";
      repBadge.classList.add("d-none");

      navPillsContainer.innerHTML = `
        <li class="nav-item">
          <button class="nav-link active" id="tab-btn-ledger" onclick="App.switchTab('ledger')">
            📜 Public Distributed Audit Ledger
          </button>
        </li>
      `;

      this.switchTab("ledger");
      await this.loadAgreements();
      return;
    }

    // CASE 3: SHIPPER (Role = 1)
    if (user.role == "1") {
      this.activeRole = 1;
      roleBadge.className = "badge bg-info text-dark px-3 py-2 fw-semibold";
      roleBadge.innerText = `📦 Shipper: ${user.name}`;
      repBadge.classList.add("d-none");

      const targetTab = (this.currentTab === "ledger") ? "ledger" : "shipper";
      navPillsContainer.innerHTML = `
        <li class="nav-item">
          <button class="nav-link ${targetTab === 'shipper' ? 'active' : ''}" id="tab-btn-shipper" onclick="App.switchTab('shipper')">
            📦 Shipper Workspace
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link ${targetTab === 'ledger' ? 'active' : ''}" id="tab-btn-ledger" onclick="App.switchTab('ledger')">
            📜 Public Audit Ledger
          </button>
        </li>
      `;

      await this.loadCarriersDropdown();
      this.recalculateShipperQuote();
      this.switchTab(targetTab);
    } 
    // CASE 4: CARRIER (Role = 2)
    else if (user.role == "2") {
      this.activeRole = 2;
      roleBadge.className = "badge bg-primary px-3 py-2 fw-semibold";
      roleBadge.innerText = `🚚 Carrier: ${user.name}`;

      const rawRep = await this.tokenContract.methods.balanceOf(this.account).call();
      let repCrt = 0;
      if (rawRep) {
        if (BigInt(rawRep) > BigInt(1000000000000)) {
          repCrt = Math.round(parseFloat(this.web3.utils.fromWei(rawRep, "ether")));
        } else {
          repCrt = parseInt(rawRep, 10) || 0;
        }
      }
      repBadge.classList.remove("d-none");

      let tier = "🥉 Bronze Tier (1.00x)";
      let progressPct = 0;
      let tierIcon = "🥉";
      let progressLabel = "";

      if (repCrt > 1500) {
        tier = "🥇 Gold Tier (1.30x)";
        tierIcon = "🥇";
        progressPct = 100;
        progressLabel = `${repCrt} CRT (Maximum Gold Tier 1.30x)`;
      } else if (repCrt >= 450) {
        tier = "🥈 Silver Tier (1.15x)";
        tierIcon = "🥈";
        progressPct = Math.min(Math.round(((repCrt - 450) / (1500 - 450)) * 100), 100);
        progressLabel = `${repCrt} / 1,500 CRT (${progressPct}% to Gold)`;
      } else {
        tier = "🥉 Bronze Tier (1.00x)";
        tierIcon = "🥉";
        progressPct = Math.min(Math.round((repCrt / 450) * 100), 100);
        progressLabel = `${repCrt} / 450 CRT (${progressPct}% to Silver)`;
      }

      repBadge.innerText = `${tierIcon} ${repCrt} CRT`;

      document.getElementById("carrierProfileTitle").innerText = user.name;
      document.getElementById("carrierProfileAddress").innerText = this.account;
      document.getElementById("carrierProfileTierIcon").innerText = tierIcon;
      document.getElementById("carrierProfileTierBadge").innerText = tier;
      document.getElementById("carrierProfileCrt").innerText = `${repCrt} CRT`;

      const progTierBadge = document.getElementById("carrierProgressionTierBadge");
      if (progTierBadge) progTierBadge.innerText = tier;

      const progBar = document.getElementById("carrierTierProgressBar");
      if (progBar) progBar.style.width = `${progressPct}%`;

      const progPercent = document.getElementById("carrierTierProgressPercent");
      if (progPercent) progPercent.innerText = progressLabel;

      const stakedEth = parseFloat(this.web3.utils.fromWei(user.securityStake, "ether"));
      document.getElementById("carrierStakeBalance").innerText = `${stakedEth.toFixed(3)} ETH (RM ${(stakedEth * this.ethToMyrRate).toFixed(2)})`;

      // Check if stake is below 0.01 ETH minimum threshold
      const reactivateBtn = document.getElementById("btnReactivateStake");
      const withdrawBtn = document.getElementById("btnWithdrawStake");
      const stakeStatusBadge = document.getElementById("carrierStakeStatus");

      if (stakedEth < 0.01) {
        reactivateBtn.classList.remove("d-none");
        withdrawBtn.classList.add("d-none");
        stakeStatusBadge.className = "badge bg-danger";
        stakeStatusBadge.innerText = "Suspended (Collateral Slashed Below 0.01 ETH)";
      } else {
        reactivateBtn.classList.add("d-none");
        withdrawBtn.classList.remove("d-none");
        stakeStatusBadge.className = "badge bg-success";
        stakeStatusBadge.innerText = "Active & Listed for Shippers";
      }

      // Preserve currently active tab if valid, otherwise default to carrier-profile
      const targetTab = (this.currentTab === "carrier-tasks" || this.currentTab === "ledger") ? this.currentTab : "carrier-profile";

      navPillsContainer.innerHTML = `
        <li class="nav-item">
          <button class="nav-link ${targetTab === 'carrier-profile' ? 'active' : ''}" id="tab-btn-carrier-profile" onclick="App.switchTab('carrier-profile')">
            👤 Carrier Profile & Analytics
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link ${targetTab === 'carrier-tasks' ? 'active' : ''}" id="tab-btn-carrier-tasks" onclick="App.switchTab('carrier-tasks')">
            🚚 Assigned Freight Tasks
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link ${targetTab === 'ledger' ? 'active' : ''}" id="tab-btn-ledger" onclick="App.switchTab('ledger')">
            📜 Public Audit Ledger
          </button>
        </li>
      `;

      this.switchTab(targetTab);
    }

    await this.loadAgreements();
  },

  switchTab: function (tabName) {
    this.currentTab = tabName;
    const views = ["disconnected", "register", "shipper", "carrier-profile", "carrier-tasks", "ledger"];
    views.forEach(v => {
      const el = document.getElementById(`view-${v}`);
      if (el) el.classList.add("d-none");
    });

    const activeView = document.getElementById(`view-${tabName}`);
    if (activeView) activeView.classList.remove("d-none");

    document.querySelectorAll(".custom-pills .nav-link").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    if (activeBtn) activeBtn.classList.add("active");

    // Invalidate Leaflet map sizes if switching to shipper
    if (tabName === "shipper" && this.isCreatePanelOpen) {
      this.invalidateAllMaps();
    }
  },

  parseAddressAndDetails: function (fullStr) {
    if (!fullStr) return { address: "-", details: "None provided" };
    if (fullStr.includes(" || Details: ")) {
      const parts = fullStr.split(" || Details: ");
      return { address: parts[0], details: parts[1] || "None provided" };
    }
    if (fullStr.includes(" [Details: ")) {
      const parts = fullStr.split(" [Details: ");
      return { address: parts[0], details: parts[1].replace(/\]$/, "") || "None provided" };
    }
    const match = fullStr.match(/^(.*?)\s*\((.*?)\)$/);
    if (match) {
      return { address: match[1], details: match[2] };
    }
    return { address: fullStr, details: "See main address coordinates" };
  },

  getNowSec: function () {
    return Math.floor(Date.now() / 1000);
  },

  startDeadlineTicker: function () {
    if (this._tickerInterval) clearInterval(this._tickerInterval);
    this._tickerInterval = setInterval(() => {
      const nowSec = App.getNowSec();
      let hasNewExpiry = false;

      (App.allAgreements || []).forEach(ag => {
        if (!ag.deadline) return;
        const dSec = parseInt(ag.deadline);
        const sIdx = parseInt(ag.status);
        // Track agreements that could expire (pending acceptance, pickup required, in transit)
        if (sIdx === 0 || sIdx === 1 || sIdx === 2) {
          if (nowSec > dSec) {
            if (!App._expiredAgreementsNotified.has(ag.id)) {
              App._expiredAgreementsNotified.add(ag.id);
              hasNewExpiry = true;
            }
          }
        }
      });

      document.querySelectorAll(".deadline-ticker-badge").forEach(el => {
        const d = el.getAttribute("data-deadline");
        const s = parseInt(el.getAttribute("data-status"));
        if (d) {
          el.innerHTML = App.formatDeadlineBadge(d, s, true);
        }
      });

      // Realtime live refresh if a deadline expires while user has page open
      if (hasNewExpiry) {
        console.log("⚡ Agreement deadline expiration detected in real-time. Live updating UI views...");
        if (App.activeRole === 1) {
          App.renderShipperView();
        } else if (App.activeRole === 2) {
          App.renderCarrierTasksView();
        }
        const modalEl = document.getElementById("shipmentDetailModal");
        const isModalOpen = modalEl && (modalEl.classList.contains("show") || modalEl.style.display === "block");
        if (isModalOpen && App.activeDetailAgreementId) {
          App.openShipmentDetailModal(App.activeDetailAgreementId);
        }
      }
    }, 1000);
  },

  getStatusDisplay: function (ag) {
    const statusIdx = parseInt(ag.status);
    const ms1 = ag.ms1;
    const ms2 = ag.ms2;
    const nowSec = this.getNowSec();
    const isPastDeadline = ag.deadline && nowSec > parseInt(ag.deadline);
    const hasRefund = ag.hasRefund || statusIdx === 4 || statusIdx === 6 || statusIdx === 7 || ag.isLate || ag.isLateCompleted;

    if (statusIdx === 0) {
      if (isPastDeadline) {
        return { name: "Expired", badgeClass: "badge-status-rejected", text: "Expired Offer" };
      }
      return { name: "PendingAcceptance", badgeClass: "badge-status-pendingacceptance", text: "Pending Acceptance" };
    }
    if (statusIdx === 1) {
      if (isPastDeadline && (!ms1 || !ms1.completed)) {
        return { name: "PickupRequired", badgeClass: "badge-status-rejected", text: "Pickup Overdue (Missed Pickup)" };
      }
      if (ms1 && ms1.completed && !ms1.approved) {
        return { name: "PickupRequired", badgeClass: "badge-status-pickuprequired", text: "Pickup Required (Submitted)" };
      }
      return { name: "PickupRequired", badgeClass: "badge-status-pickuprequired", text: "Pickup Required" };
    }
    if (statusIdx === 2) {
      if (ms2 && ms2.completed && !ms2.approved) {
        if (ag.ms2SubmittedOnTime) {
          return { name: "InTransit", badgeClass: "badge-status-intransit", text: "Submitted On Time (Awaiting Shipper Approval)" };
        }
        if (isPastDeadline) {
          return { name: "InTransit", badgeClass: "badge-status-delivering", text: "Late Delivery Submitted (Awaiting Validation)" };
        }
        return { name: "InTransit", badgeClass: "badge-status-intransit", text: "In Transit (Delivery Submitted)" };
      }
      if (isPastDeadline) {
        return { name: "InTransit", badgeClass: "badge-status-delivering", text: "In Transit (Overdue)" };
      }
      return { name: "InTransit", badgeClass: "badge-status-intransit", text: "In Transit" };
    }
    if (statusIdx === 3) {
      if (hasRefund || isPastDeadline || ag.isLate || ag.isLateCompleted) {
        return { name: "Completed", badgeClass: "badge-status-completed", text: "Completed & Refunded (Late Delivery)" };
      }
      return { name: "Completed", badgeClass: "badge-status-completed", text: "Completed & Fully Settled" };
    }
    if (statusIdx === 4) {
      if (ms2 && ms2.completed && !ms2.approved) {
        return { name: "InTransit", badgeClass: "badge-status-delivering", text: "Late Delivery Submitted (Awaiting Validation)" };
      }
      if (ms1 && ms1.completed) {
        return { name: "InTransit", badgeClass: "badge-status-delivering", text: "In Transit (70% Refunded)" };
      }
      if (ag.wasAccepted) {
        return { name: "Refunded", badgeClass: "badge-status-refunded", text: "Cancelled & Refunded (Missed Pickup)" };
      }
      return { name: "Refunded", badgeClass: "badge-status-refunded", text: "Cancelled & Refunded (Not Accepted)" };
    }
    if (statusIdx === 5) {
      return { name: "Disputed", badgeClass: "badge-status-disputed", text: "Disputed" };
    }
    if (statusIdx === 6) {
      if (ag.wasAccepted) {
        return { name: "Cancelled", badgeClass: "badge-status-cancelled", text: "Cancelled & Refunded (Missed Pickup)" };
      }
      return { name: "Cancelled", badgeClass: "badge-status-cancelled", text: "Cancelled & Refunded (Not Accepted)" };
    }
    if (statusIdx === 7) {
      return { name: "Declined", badgeClass: "badge-status-rejected", text: "Declined & Refunded" };
    }
    return { name: "Unknown", badgeClass: "badge-status-refunded", text: "Unknown" };
  },

  formatDeadlineBadge: function (deadlineSec, statusIdx, isInnerUpdate) {
    const sec = parseInt(deadlineSec);
    const deadlineDate = new Date(sec * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    const nowSec = this.getNowSec();
    const diffSec = sec - nowSec;

    let content = "";
    // Completed or cancelled without expiry (notice statusIdx === 4 Refunded is NOT here, ensuring overdue refunded jobs show red EXPIRED)
    if (statusIdx === 3 || statusIdx === 6 || statusIdx === 7) {
      content = `<span class="badge bg-secondary bg-opacity-50 text-light px-2 py-1">📅 ${deadlineDate}</span>`;
    } else if (diffSec <= 0) {
      const overdueSec = Math.abs(diffSec);
      let overdueStr = "";
      if (overdueSec < 60) {
        overdueStr = `${overdueSec}s overdue`;
      } else if (overdueSec < 3600) {
        const mins = Math.floor(overdueSec / 60);
        overdueStr = `${mins}m overdue`;
      } else {
        const hours = Math.floor(overdueSec / 3600);
        overdueStr = `${hours}h overdue`;
      }
      content = `<span class="badge bg-danger text-white px-2 py-1 fw-bold border border-danger shadow-sm"><span class="me-1">⚠️</span>EXPIRED: ${deadlineDate} (${overdueStr})</span>`;
    } else if (diffSec < 86400) { // Under 24 hours (under 1 day)
      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = diffSec % 60;
      let leftStr = "";
      if (hours > 0) {
        leftStr = `${hours}h ${mins}m left`;
      } else if (mins > 0) {
        leftStr = `${mins}m ${secs}s left`;
      } else {
        leftStr = `${secs}s left`;
      }
      content = `<span class="badge bg-warning text-dark px-2 py-1 fw-bold border border-warning shadow-sm"><span class="me-1">⏰</span>DUE SOON (&lt;24h): ${deadlineDate} (${leftStr})</span>`;
    } else {
      const days = Math.floor(diffSec / 86400);
      const hours = Math.floor((diffSec % 86400) / 3600);
      content = `<span class="badge bg-dark bg-opacity-75 text-info border border-secondary px-2 py-1"><span class="me-1">📅</span>Deadline: ${deadlineDate} (${days}d ${hours}h left)</span>`;
    }

    if (isInnerUpdate) {
      return content;
    }
    return `<span class="deadline-ticker-badge" data-deadline="${sec}" data-status="${statusIdx}">${content}</span>`;
  },

  onRoleSelectChange: function () {
    const role = document.getElementById("regRole").value;
    const stakeGroup = document.getElementById("carrierStakeGroup");
    if (role === "2") {
      stakeGroup.classList.remove("d-none");
    } else {
      stakeGroup.classList.add("d-none");
    }
  },

  registerUser: async function (btn) {
    const triggerBtn = btn || document.getElementById("btnRegisterUser");
    const name = document.getElementById("regName").value.trim();
    const role = document.getElementById("regRole").value;
    if (!name) {
      return this.showFieldValidationError("regName", "Missing Name", "Please enter your Company or Personal name to register!");
    }

    let valueToSend = "0";
    if (role === "2") {
      valueToSend = this.web3.utils.toWei("0.01", "ether"); // Mandatory fixed 0.01 ETH stake
    }

    try {
      this.showTxLoading("Registering Account", "Confirming registration in MetaMask...", "Smart contract registration & fleet activation", triggerBtn);
      await this.escrowContract.methods.registerUser(name, role).send({
        from: this.account,
        value: valueToSend
      });
      this.showToast("Registration Successful", "Welcome to LogiChain Escrow!", "success");
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Registration Cancelled", "MetaMask signature request was cancelled.", "cancel");
      } else {
        this.showToast("Registration Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(triggerBtn);
    }
  },

  // ================= SHIPPER & 3-MAP LEAFLET SYSTEM =================
  malaysiaHubPresets: {
    "bayan lepas": { lat: 5.2974, lng: 100.2762, name: "Bayan Lepas Free Industrial Zone, Penang" },
    "george town": { lat: 5.4141, lng: 100.3288, name: "George Town, Penang" },
    "butterworth": { lat: 5.3991, lng: 100.3638, name: "North Butterworth Container Terminal, Penang" },
    "bukit minyak": { lat: 5.3197, lng: 100.4633, name: "Bukit Minyak Industrial Park, Penang" },
    "kulim": { lat: 5.3855, lng: 100.5567, name: "Kulim Hi-Tech Park, Kedah" },
    "alor setar": { lat: 6.1256, lng: 100.3673, name: "Alor Setar Logistics Hub, Kedah" },
    "ipoh": { lat: 4.5975, lng: 101.0901, name: "Ipoh Cargo Terminal, Perak" },
    "taiping": { lat: 4.8500, lng: 100.7333, name: "Kamunting Industrial Area, Taiping, Perak" },
    "port klang": { lat: 3.0039, lng: 101.3934, name: "Port Klang Westports / PKFZ, Selangor" },
    "westports": { lat: 2.9555, lng: 101.3122, name: "Westports Container Terminal, Port Klang" },
    "northport": { lat: 3.0232, lng: 101.3650, name: "Northport Logistics Depot, Selangor" },
    "shah alam": { lat: 3.0738, lng: 101.5183, name: "Shah Alam Section 22 Logistics Hub, Selangor" },
    "subang jaya": { lat: 3.0565, lng: 101.5851, name: "Subang Hi-Tech Industrial Park, Selangor" },
    "petaling jaya": { lat: 3.1073, lng: 101.6067, name: "Petaling Jaya Industrial Zone, Selangor" },
    "kuala lumpur": { lat: 3.1390, lng: 101.6869, name: "Kuala Lumpur Central Freight Depot, KL" },
    "cyberjaya": { lat: 2.9213, lng: 101.6559, name: "Cyberjaya Tech Park, Selangor" },
    "putrajaya": { lat: 2.9264, lng: 101.6964, name: "Putrajaya Administrative Center" },
    "klia": { lat: 2.7456, lng: 101.7072, name: "KLIA Cargo Village / Sepang, Selangor" },
    "nilai": { lat: 2.8167, lng: 101.7972, name: "Nilai Inland Port & Logistics Hub, Negeri Sembilan" },
    "seremban": { lat: 2.7258, lng: 101.9424, name: "Seremban Senawang Industrial Area, Negeri Sembilan" },
    "melaka": { lat: 2.2500, lng: 102.2500, name: "Melaka Ayer Keroh Industrial Area" },
    "batu pahat": { lat: 1.8548, lng: 102.9325, name: "Batu Pahat Industrial Park, Johor" },
    "senai": { lat: 1.5997, lng: 103.6482, name: "Senai Airport Cargo Logistics Park, Johor" },
    "johor bahru": { lat: 1.4927, lng: 103.7414, name: "Johor Bahru Central Hub, Johor" },
    "pasir gudang": { lat: 1.4705, lng: 103.9056, name: "Johor Port, Pasir Gudang, Johor" },
    "tanjung pelepas": { lat: 1.3653, lng: 103.5503, name: "Port of Tanjung Pelepas (PTP), Johor" },
    "kuantan": { lat: 3.8077, lng: 103.3260, name: "Kuantan Port / Gebeng Industrial Estate, Pahang" },
    "kemaman": { lat: 4.2333, lng: 103.4167, name: "Kemaman Supply Base (KSB), Terengganu" },
    "kuala terengganu": { lat: 5.3302, lng: 103.1408, name: "Kuala Terengganu Freight Depot, Terengganu" },
    "kota bharu": { lat: 6.1254, lng: 102.2386, name: "Pengkalan Chepa Industrial Hub, Kota Bharu, Kelantan" }
  },

  toggleCreateAgreementPanel: function () {
    const container = document.getElementById("createAgreementContainer");
    const btnText = document.getElementById("createBtnText");
    const btnIcon = document.getElementById("createBtnIcon");

    this.isCreatePanelOpen = !this.isCreatePanelOpen;
    if (this.isCreatePanelOpen) {
      container.classList.remove("d-none");
      btnText.innerText = "Close Creation Form";
      btnIcon.innerText = "✖";
      this.initAllMaps();
    } else {
      container.classList.add("d-none");
      btnText.innerText = "Create New Shipment Agreement";
      btnIcon.innerText = "➕";
    }
  },

  initAllMaps: function () {
    // If maps already initialized, simply invalidate their sizes
    if (this.originMap && this.destMap && this.routeOverviewMap) {
      this.invalidateAllMaps();
      return;
    }

    const createTileLayer = () => {
      return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 18
      });
    };

    const defaultCenter = [4.2105, 101.9758]; // Malaysia central map center

    // 1. Origin Map (Interactive: keyword search, pin drag, click to pick)
    const originEl = document.getElementById("originMap");
    if (originEl && !this.originMap) {
      this.originMap = L.map("originMap", { zoomControl: true }).setView(this.originCoords || defaultCenter, this.originCoords ? 11 : 6);
      createTileLayer().addTo(this.originMap);

      if (this.originCoords) {
        this.originMarker = L.marker(this.originCoords, { draggable: true, title: "Origin Pickup" }).addTo(this.originMap);
        this.originMarker.bindPopup("<b>🟢 Origin Location</b><br><small>Drag pin or click map to move</small>").openPopup();
        this.originMarker.on("dragend", async () => {
          const latlng = this.originMarker.getLatLng();
          const check = await this.isLocationInMalaysia(latlng.lat, latlng.lng);
          if (!check.valid) {
            const title = check.isEastMalaysia ? "East Malaysia Not Supported" : "Location Outside Malaysia";
            this.showToast(title, `${check.reason} Pin has been snapped back.`, "error", 5500);
            if (this.originCoords) this.originMarker.setLatLng(this.originCoords);
            return;
          }
          this.setOriginLocation(latlng.lat, latlng.lng);
        });
      }

      this.originMap.on("click", async (e) => {
        const check = await this.isLocationInMalaysia(e.latlng.lat, e.latlng.lng);
        if (!check.valid) {
          const title = check.isEastMalaysia ? "East Malaysia Not Supported" : "Location Outside Malaysia";
          this.showToast(title, `${check.reason} Please select a location within Peninsular Malaysia.`, "error", 5500);
          return;
        }
        this.setOriginLocation(e.latlng.lat, e.latlng.lng);
      });
    }

    // 2. Destination Map (Interactive: keyword search, pin drag, click to pick)
    const destEl = document.getElementById("destMap");
    if (destEl && !this.destMap) {
      this.destMap = L.map("destMap", { zoomControl: true }).setView(this.destCoords || defaultCenter, this.destCoords ? 11 : 6);
      createTileLayer().addTo(this.destMap);

      if (this.destCoords) {
        this.destMarker = L.marker(this.destCoords, { draggable: true, title: "Destination" }).addTo(this.destMap);
        this.destMarker.bindPopup("<b>🔴 Destination Location</b><br><small>Drag pin or click map to move</small>").openPopup();
        this.destMarker.on("dragend", async () => {
          const latlng = this.destMarker.getLatLng();
          const check = await this.isLocationInMalaysia(latlng.lat, latlng.lng);
          if (!check.valid) {
            const title = check.isEastMalaysia ? "East Malaysia Not Supported" : "Location Outside Malaysia";
            this.showToast(title, `${check.reason} Pin has been snapped back.`, "error", 5500);
            if (this.destCoords) this.destMarker.setLatLng(this.destCoords);
            return;
          }
          this.setDestLocation(latlng.lat, latlng.lng);
        });
      }

      this.destMap.on("click", async (e) => {
        const check = await this.isLocationInMalaysia(e.latlng.lat, e.latlng.lng);
        if (!check.valid) {
          const title = check.isEastMalaysia ? "East Malaysia Not Supported" : "Location Outside Malaysia";
          this.showToast(title, `${check.reason} Please select a location within Peninsular Malaysia.`, "error", 5500);
          return;
        }
        this.setDestLocation(e.latlng.lat, e.latlng.lng);
      });
    }

    // 3. Route Overview Map (Bigger Map, Strictly Read-Only Result Preview)
    const routeEl = document.getElementById("routeOverviewMap");
    if (routeEl && !this.routeOverviewMap) {
      this.routeOverviewMap = L.map("routeOverviewMap", {
        zoomControl: true
      }).setView(defaultCenter, 6);
      createTileLayer().addTo(this.routeOverviewMap);
      this.updateOverviewMap();
    }

    this.invalidateAllMaps();
  },

  isLocationInMalaysia: async function (lat, lng) {
    // 1. East Malaysia check: Sabah & Sarawak (East Malaysia area)
    // Longitude of Peninsular Malaysia (West) is ~99.5° E to ~104.8° E.
    // Borneo (Sarawak & Sabah) starts at longitude ~109.5° E (and any lng >= 108.5° E).
    if (lng >= 108.5) {
      return {
        valid: false,
        isEastMalaysia: true,
        reason: "The selected location is in Sabah / Sarawak (East Malaysia). Our freight transport network currently services Peninsular Malaysia (West Malaysia) only."
      };
    }

    // 2. Geographic Bounding Box Check for Peninsular Malaysia
    if (lat < 1.15 || lat > 6.90 || lng < 99.50 || lng > 104.80) {
      return {
        valid: false,
        isEastMalaysia: false,
        reason: "Selected coordinates are outside Peninsular Malaysia's geographical boundaries."
      };
    }

    // 3. Reverse Geocode country and state validation via OpenStreetMap Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`;
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      const data = await res.json();
      if (!data || data.error) {
        return {
          valid: false,
          isEastMalaysia: false,
          reason: "Selected point is in maritime waters or an unmapped territory."
        };
      }
      const countryCode = data.address && data.address.country_code ? data.address.country_code.toLowerCase() : "";
      const countryName = data.address && data.address.country ? data.address.country : "an overseas country";
      if (countryCode && countryCode !== "my") {
        return {
          valid: false,
          isEastMalaysia: false,
          reason: `Selected location is in ${countryName}, which is outside Malaysia.`
        };
      }

      // Check state or address for Sabah / Sarawak / Labuan
      const state = (data.address && (data.address.state || data.address.region || "")) ? (data.address.state || data.address.region || "").toLowerCase() : "";
      const displayName = (data.display_name || "").toLowerCase();
      if (
        state.includes("sabah") || state.includes("sarawak") || state.includes("labuan") ||
        displayName.includes("sabah") || displayName.includes("sarawak") || displayName.includes("labuan")
      ) {
        return {
          valid: false,
          isEastMalaysia: true,
          reason: "The selected location is in Sabah / Sarawak (East Malaysia). Our freight transport network currently services Peninsular Malaysia (West Malaysia) only."
        };
      }

      return { valid: true, data };
    } catch (e) {
      // If network fails, fallback to coordinates bounding box check
      return { valid: true };
    }
  },

  invalidateAllMaps: function () {
    setTimeout(() => {
      if (this.originMap) this.originMap.invalidateSize();
      if (this.destMap) this.destMap.invalidateSize();
      if (this.routeOverviewMap) {
        this.routeOverviewMap.invalidateSize();
        this.updateOverviewMap();
      }
    }, 250);
  },

  setOriginLocation: async function (lat, lng, addressLabel) {
    const check = await this.isLocationInMalaysia(lat, lng);
    if (!check.valid) {
      const title = check.isEastMalaysia ? "East Malaysia Not Supported" : "Location Outside Malaysia";
      this.showToast(title, `${check.reason} Please select a location within Peninsular Malaysia.`, "error", 5500);
      if (this.originMarker && this.originCoords) {
        this.originMarker.setLatLng(this.originCoords);
      }
      return;
    }
    if (!addressLabel && check.data && check.data.display_name) {
      addressLabel = check.data.display_name.split(",").slice(0, 3).join(", ");
    }

    this.originCoords = [lat, lng];
    if (this.originMap) {
      if (!this.originMarker) {
        this.originMarker = L.marker(this.originCoords, { draggable: true, title: "Origin Pickup" }).addTo(this.originMap);
        this.originMarker.on("dragend", async () => {
          const latlng = this.originMarker.getLatLng();
          const check = await this.isLocationInMalaysia(latlng.lat, latlng.lng);
          if (!check.valid) {
            const title = check.isEastMalaysia ? "East Malaysia Not Supported" : "Location Outside Malaysia";
            this.showToast(title, `${check.reason} Pin has been snapped back.`, "error", 5500);
            if (this.originCoords) this.originMarker.setLatLng(this.originCoords);
            return;
          }
          this.setOriginLocation(latlng.lat, latlng.lng);
        });
      } else {
        this.originMarker.setLatLng(this.originCoords);
      }
      this.originMap.panTo(this.originCoords);
    }

    const addrInput = document.getElementById("originSelectedAddress");
    if (addressLabel) {
      if (addrInput) addrInput.value = `${addressLabel} (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
      if (this.originMarker) {
        this.originMarker.bindPopup(`<b>🟢 Origin:</b> ${addressLabel}`).openPopup();
      }
    } else {
      if (addrInput) addrInput.value = `Custom Pinpoint (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
      this.reverseGeocode(lat, lng, "origin");
    }

    this.updateOverviewMap();
    this.recalculateMapDistance();
  },

  setDestLocation: async function (lat, lng, addressLabel) {
    const check = await this.isLocationInMalaysia(lat, lng);
    if (!check.valid) {
      const title = check.isEastMalaysia ? "East Malaysia Not Supported" : "Location Outside Malaysia";
      this.showToast(title, `${check.reason} Please select a location within Peninsular Malaysia.`, "error", 5500);
      if (this.destMarker && this.destCoords) {
        this.destMarker.setLatLng(this.destCoords);
      }
      return;
    }
    if (!addressLabel && check.data && check.data.display_name) {
      addressLabel = check.data.display_name.split(",").slice(0, 3).join(", ");
    }

    this.destCoords = [lat, lng];
    if (this.destMap) {
      if (!this.destMarker) {
        this.destMarker = L.marker(this.destCoords, { draggable: true, title: "Destination" }).addTo(this.destMap);
        this.destMarker.on("dragend", async () => {
          const latlng = this.destMarker.getLatLng();
          const check = await this.isLocationInMalaysia(latlng.lat, latlng.lng);
          if (!check.valid) {
            const title = check.isEastMalaysia ? "East Malaysia Not Supported" : "Location Outside Malaysia";
            this.showToast(title, `${check.reason} Pin has been snapped back.`, "error", 5500);
            if (this.destCoords) this.destMarker.setLatLng(this.destCoords);
            return;
          }
          this.setDestLocation(latlng.lat, latlng.lng);
        });
      } else {
        this.destMarker.setLatLng(this.destCoords);
      }
      this.destMap.panTo(this.destCoords);
    }

    const addrInput = document.getElementById("destSelectedAddress");
    if (addressLabel) {
      if (addrInput) addrInput.value = `${addressLabel} (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
      if (this.destMarker) {
        this.destMarker.bindPopup(`<b>🔴 Destination:</b> ${addressLabel}`).openPopup();
      }
    } else {
      if (addrInput) addrInput.value = `Custom Pinpoint (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
      this.reverseGeocode(lat, lng, "dest");
    }

    this.updateOverviewMap();
    this.recalculateMapDistance();
  },

  updateOverviewMap: function () {
    if (!this.routeOverviewMap) return;

    if (!this.originCoords || !this.destCoords) {
      if (this.overviewRouteLine) {
        this.routeOverviewMap.removeLayer(this.overviewRouteLine);
        this.overviewRouteLine = null;
      }
      return;
    }

    if (!this.overviewOriginMarker) {
      this.overviewOriginMarker = L.marker(this.originCoords, { interactive: true, title: "Origin Point (Read-Only)" })
        .addTo(this.routeOverviewMap)
        .bindPopup("<b>🟢 Origin Location</b>");
    } else {
      this.overviewOriginMarker.setLatLng(this.originCoords);
    }

    if (!this.overviewDestMarker) {
      this.overviewDestMarker = L.marker(this.destCoords, { interactive: true, title: "Destination Point (Read-Only)" })
        .addTo(this.routeOverviewMap)
        .bindPopup("<b>🔴 Destination Location</b>");
    } else {
      this.overviewDestMarker.setLatLng(this.destCoords);
    }

    if (this.overviewRouteLine) {
      this.routeOverviewMap.removeLayer(this.overviewRouteLine);
    }

    this.overviewRouteLine = L.polyline([this.originCoords, this.destCoords], {
      color: "#6366f1",
      weight: 4,
      opacity: 0.85,
      dashArray: "8, 8"
    }).addTo(this.routeOverviewMap);

    try {
      const bounds = L.latLngBounds([this.originCoords, this.destCoords]);
      this.routeOverviewMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    } catch (e) {
      console.warn("Could not fit route overview bounds:", e);
    }
  },

  searchLocation: async function (type) {
    const inputId = type === "origin" ? "originSearchInput" : "destSearchInput";
    const query = document.getElementById(inputId).value.trim();
    if (!query) {
      this.showToast("Search Empty", "Please enter a location keyword to search (e.g. Shah Alam, Kuantan, Bayan Lepas).", "error");
      return;
    }

    const qLower = query.toLowerCase();

    // 1. Check Malaysian Logistics Presets first for instant response
    for (const [key, hub] of Object.entries(this.malaysiaHubPresets)) {
      if (qLower.includes(key) || key.includes(qLower)) {
        if (type === "origin") {
          this.setOriginLocation(hub.lat, hub.lng, hub.name);
        } else {
          this.setDestLocation(hub.lat, hub.lng, hub.name);
        }
        return;
      }
    }

    // 2. Query OpenStreetMap Nominatim for general addresses with country restriction
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=my&limit=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      const data = await res.json();
      if (data && data.length > 0) {
        const item = data[0];
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        const name = item.display_name.split(",").slice(0, 3).join(", ");
        if (type === "origin") {
          this.setOriginLocation(lat, lng, name);
        } else {
          this.setDestLocation(lat, lng, name);
        }
      } else {
        this.showToast("Location Not Found", `Location "${query}" was not found in Malaysia. Try a nearby city or click on the map.`, "error", 5000);
      }
    } catch (e) {
      console.error("Nominatim search failed:", e);
      this.showToast("Search Unavailable", "Location search service unavailable. Please click directly on the map to place pin.", "error");
    }
  },

  reverseGeocode: async function (lat, lng, type) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`;
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      const data = await res.json();
      if (data && data.display_name) {
        const countryCode = data.address && data.address.country_code ? data.address.country_code.toLowerCase() : "";
        if (countryCode && countryCode !== "my") {
          this.showToast("Location Outside Malaysia", `Selected location is in ${data.address.country || "another country"}. Please pick a location within Malaysia.`, "error", 5000);
          return;
        }
        const state = (data.address && (data.address.state || data.address.region || "")) ? (data.address.state || data.address.region || "").toLowerCase() : "";
        const displayName = (data.display_name || "").toLowerCase();
        if (
          lng >= 108.5 ||
          state.includes("sabah") || state.includes("sarawak") || state.includes("labuan") ||
          displayName.includes("sabah") || displayName.includes("sarawak") || displayName.includes("labuan")
        ) {
          this.showToast("East Malaysia Not Supported", "The selected location is in Sabah / Sarawak (East Malaysia). Our freight transport network currently services Peninsular Malaysia (West Malaysia) only.", "error", 5500);
          return;
        }
        const readable = data.display_name.split(",").slice(0, 3).join(", ");
        const addrInput = document.getElementById(type === "origin" ? "originSelectedAddress" : "destSelectedAddress");
        addrInput.value = `${readable} (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
        if (type === "origin" && this.originMarker) {
          this.originMarker.bindPopup(`<b>🟢 Origin:</b> ${readable}`).openPopup();
        } else if (type === "dest" && this.destMarker) {
          this.destMarker.bindPopup(`<b>🔴 Destination:</b> ${readable}`).openPopup();
        }
      }
    } catch (e) {
      console.warn("Reverse geocode failed:", e);
    }
  },

  geocodeAndPin: async function (query, type) {
    if (!query) return;
    try {
      const clean = query.toLowerCase();
      for (const [key, preset] of Object.entries(this.malaysiaHubPresets || {})) {
        if (clean.includes(key.toLowerCase()) || clean.includes(preset.name.toLowerCase())) {
          if (type === "origin") {
            this.setOriginLocation(preset.lat, preset.lng, preset.name);
          } else {
            this.setDestLocation(preset.lat, preset.lng, preset.name);
          }
          return;
        }
      }

      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        const label = data[0].display_name.split(",")[0];
        if (type === "origin") {
          this.setOriginLocation(lat, lng, label);
        } else {
          this.setDestLocation(lat, lng, label);
        }
      }
    } catch (e) {
      console.warn("Geocoding failed for:", query, e);
    }
  },

  recalculateMapDistance: function () {
    if (!this.originCoords || !this.destCoords) {
      const distInput = document.getElementById("createDistance");
      if (distInput && !distInput.value) {
        distInput.value = "";
      }
      this.recalculateShipperQuote();
      return;
    }

    // Geodesic Haversine calculation with +25% highway curvature multiplier
    const [lat1, lon1] = this.originCoords;
    const [lat2, lon2] = this.destCoords;
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const straightDist = R * c;
    const highwayDist = Math.round(straightDist * 1.25);

    document.getElementById("createDistance").value = Math.max(highwayDist, 10);
    this.recalculateShipperQuote();
  },

  setQuickDeadline: function (hours) {
    const d = new Date(Date.now() + hours * 3600 * 1000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const input = document.getElementById("createExactDeadline");
    if (input) {
      input.value = `${year}-${month}-${day}T${h}:${m}`;
      // Prevent selecting past dates
      const now = new Date();
      const minYear = now.getFullYear();
      const minMonth = String(now.getMonth() + 1).padStart(2, "0");
      const minDay = String(now.getDate()).padStart(2, "0");
      const minH = String(now.getHours()).padStart(2, "0");
      const minM = String(now.getMinutes()).padStart(2, "0");
      input.min = `${minYear}-${minMonth}-${minDay}T${minH}:${minM}`;
    }
  },

  onCargoPhotoSelected: function (input) {
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const preview = document.getElementById("cargoPhotoPreview");
        preview.src = e.target.result;
        preview.classList.remove("d-none");
      };
      reader.readAsDataURL(input.files[0]);
    }
  },

  recalculateShipperQuote: function () {
    const distInput = document.getElementById("createDistance");
    const weightInput = document.getElementById("createWeight");
    const dist = distInput && distInput.value ? parseFloat(distInput.value) : 0;
    const weight = weightInput && weightInput.value ? parseFloat(weightInput.value) : 0;
    
    // Read multiplier from selected carrier
    const select = document.getElementById("shipperCarrierSelect");
    const selectedOpt = select && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    let multiplier = 1.0;
    if (selectedOpt && selectedOpt.dataset.multiplier) {
      multiplier = parseFloat(selectedOpt.dataset.multiplier);
    }

    if (dist === 0 && weight === 0) {
      const quoteDist = document.getElementById("quoteDistFee");
      if (quoteDist) quoteDist.innerText = "0.0000 ETH (RM 0.00)";
      const quoteWeight = document.getElementById("quoteWeightFee");
      if (quoteWeight) quoteWeight.innerText = "0.0000 ETH (RM 0.00)";
      const quoteMult = document.getElementById("quoteMultiplier");
      if (quoteMult) quoteMult.innerText = `${multiplier.toFixed(2)}x`;
      const quoteEth = document.getElementById("quoteTotalEth");
      if (quoteEth) quoteEth.innerText = "0.0000 ETH";
      const quoteMyr = document.getElementById("quoteTotalMyr");
      if (quoteMyr) quoteMyr.innerText = "(≈ RM 0.00 MYR)";
      return;
    }

    const baseFee = 0.0020;
    const distFee = dist * 0.00005;
    const weightFee = weight * 0.00001;
    const totalEth = (baseFee + distFee + weightFee) * multiplier;
    const totalMyr = totalEth * this.ethToMyrRate;

    const quoteDist = document.getElementById("quoteDistFee");
    if (quoteDist) quoteDist.innerText = `${distFee.toFixed(4)} ETH (RM ${(distFee * this.ethToMyrRate).toFixed(2)})`;
    const quoteWeight = document.getElementById("quoteWeightFee");
    if (quoteWeight) quoteWeight.innerText = `${weightFee.toFixed(4)} ETH (RM ${(weightFee * this.ethToMyrRate).toFixed(2)})`;
    const quoteMult = document.getElementById("quoteMultiplier");
    if (quoteMult) quoteMult.innerText = `${multiplier.toFixed(2)}x`;
    const quoteEth = document.getElementById("quoteTotalEth");
    if (quoteEth) quoteEth.innerText = `${totalEth.toFixed(4)} ETH`;
    const quoteMyr = document.getElementById("quoteTotalMyr");
    if (quoteMyr) quoteMyr.innerText = `(≈ RM ${totalMyr.toFixed(2)} MYR)`;
  },

  clearCreateAgreementForm: function () {
    const desc = document.getElementById("createCargoDesc");
    if (desc) desc.value = "";

    const carrierSelect = document.getElementById("shipperCarrierSelect");
    if (carrierSelect) carrierSelect.value = "";
    const carrierDetails = document.getElementById("carrierSelectedDetails");
    if (carrierDetails) carrierDetails.innerText = "Select a carrier to review verified tier & reliability multiplier.";

    const cargoVal = document.getElementById("createCargoValue");
    if (cargoVal) cargoVal.value = "";
    const weight = document.getElementById("createWeight");
    if (weight) weight.value = "";

    const photoInput = document.getElementById("createCargoPhotoInput");
    if (photoInput) photoInput.value = "";
    const photoPreview = document.getElementById("cargoPhotoPreview");
    if (photoPreview) {
      photoPreview.src = "";
      photoPreview.classList.add("d-none");
    }

    const origSearch = document.getElementById("originSearchInput");
    if (origSearch) origSearch.value = "";
    const origAddr = document.getElementById("originSelectedAddress");
    if (origAddr) origAddr.value = "";
    const origDet = document.getElementById("originAddressDetails");
    if (origDet) origDet.value = "";

    const destSearch = document.getElementById("destSearchInput");
    if (destSearch) destSearch.value = "";
    const destAddr = document.getElementById("destSelectedAddress");
    if (destAddr) destAddr.value = "";
    const destDet = document.getElementById("destAddressDetails");
    if (destDet) destDet.value = "";

    const dist = document.getElementById("createDistance");
    if (dist) dist.value = "";
    const deadline = document.getElementById("createExactDeadline");
    if (deadline) deadline.value = "";

    this.originCoords = null;
    this.destCoords = null;
    if (this.originMarker && this.originMap) {
      this.originMap.removeLayer(this.originMarker);
      this.originMarker = null;
    }
    if (this.destMarker && this.destMap) {
      this.destMap.removeLayer(this.destMarker);
      this.destMarker = null;
    }
    if (this.overviewOriginMarker && this.routeOverviewMap) {
      this.routeOverviewMap.removeLayer(this.overviewOriginMarker);
      this.overviewOriginMarker = null;
    }
    if (this.overviewDestMarker && this.routeOverviewMap) {
      this.routeOverviewMap.removeLayer(this.overviewDestMarker);
      this.overviewDestMarker = null;
    }
    if (this.overviewRouteLine && this.routeOverviewMap) {
      this.routeOverviewMap.removeLayer(this.overviewRouteLine);
      this.overviewRouteLine = null;
    }

    const alertEl = document.getElementById("createFormErrorAlert");
    if (alertEl) {
      alertEl.classList.add("d-none");
      alertEl.classList.remove("d-flex");
    }
    document.querySelectorAll(".form-field-invalid").forEach(el => el.classList.remove("form-field-invalid"));

    this.recalculateShipperQuote();
  },

  loadCarriersDropdown: async function () {
    if (!this.escrowContract) return;
    const select = document.getElementById("shipperCarrierSelect");
    select.innerHTML = `<option value="">-- Choose Registered Carrier --</option>`;

    const count = await this.escrowContract.methods.getCarriersCount().call();
    let addedCount = 0;
    for (let i = 0; i < count; i++) {
      const carrierAddr = await this.escrowContract.methods.registeredCarriers(i).call();
      const carrierUser = await this.escrowContract.methods.users(carrierAddr).call();
      
      const stakeWei = BigInt(carrierUser.securityStake || "0");
      const minStakeWei = BigInt(this.web3.utils.toWei("0.01", "ether"));
      // Only show activated carriers with active security stake
      if (stakeWei < minStakeWei) {
        continue;
      }

      const rawRep = await this.tokenContract.methods.balanceOf(carrierAddr).call();
      let repCrt = 0;
      if (rawRep) {
        if (BigInt(rawRep) > BigInt(1000000000000)) {
          repCrt = Math.round(parseFloat(this.web3.utils.fromWei(rawRep, "ether")));
        } else {
          repCrt = parseInt(rawRep, 10) || 0;
        }
      }

      let tier = "🥉 Bronze";
      let multiplier = "1.00";
      if (repCrt > 1500) {
        tier = "🥇 Gold";
        multiplier = "1.30";
      } else if (repCrt >= 450) {
        tier = "🥈 Silver";
        multiplier = "1.15";
      }

      const opt = document.createElement("option");
      opt.value = carrierAddr;
      opt.text = `${carrierUser.name} [${tier} - ${repCrt} CRT] (${carrierAddr.substring(0, 6)}...${carrierAddr.substring(38)})`;
      opt.dataset.multiplier = multiplier;
      select.appendChild(opt);
      addedCount++;
    }

    if (addedCount === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.disabled = true;
      opt.text = "-- No Activated Carriers (Min 0.01 ETH Stake Required) --";
      select.appendChild(opt);
    }
  },

  onCarrierSelectChange: function () {
    const select = document.getElementById("shipperCarrierSelect");
    const details = document.getElementById("carrierSelectedDetails");
    const selectedOpt = select.options[select.selectedIndex];
    if (selectedOpt && selectedOpt.value) {
      details.innerHTML = `<span class="text-success">Verified: <b>${selectedOpt.text}</b> (Rate Multiplier: ${selectedOpt.dataset.multiplier || '1.0'}x)</span>`;
      this.recalculateShipperQuote();
    } else {
      details.innerText = "Select a carrier to review verified tier & reliability multiplier.";
    }
  },

  createAgreement: async function (btn) {
    if (!btn) btn = document.getElementById("btnCreateAgreement");
    const carrier = document.getElementById("shipperCarrierSelect").value;
    const deadlineInput = document.getElementById("createExactDeadline").value;
    const totalEthStr = document.getElementById("quoteTotalEth").innerText.replace(" ETH", "").trim();

    if (!carrier || !this.web3.utils.isAddress(carrier)) {
      return this.showFieldValidationError("shipperCarrierSelect", "Carrier Required", "Please choose a designated registered carrier from the fleet dropdown!");
    }
    if (!deadlineInput) {
      return this.showFieldValidationError("createExactDeadline", "Deadline Required", "Please set an exact delivery completion deadline!");
    }

    const deadlineTimestamp = Math.floor(new Date(deadlineInput).getTime() / 1000);
    if (deadlineTimestamp <= Math.floor(Date.now() / 1000)) {
      return this.showFieldValidationError("createExactDeadline", "Invalid Deadline", "The delivery completion deadline must be a future date and time!");
    }

    const cargoDesc = document.getElementById("createCargoDesc").value.trim();
    if (!cargoDesc) {
      return this.showFieldValidationError("createCargoDesc", "Cargo Manifest Required", "Please enter the cargo description / item manifest!");
    }

    const originAddress = document.getElementById("originSelectedAddress").value;
    if (!originAddress) {
      return this.showFieldValidationError("originSearchInput", "Origin Location Required", "Please select an origin / pickup location on the map or search!");
    }
    const originDetails = document.getElementById("originAddressDetails").value.trim();
    if (!originDetails) {
      return this.showFieldValidationError("originAddressDetails", "Origin Details Required", "Please enter the specific Manual Address Details for Origin / Pickup (e.g. Building, Dock, Bay, Unit, or Contact Info)!");
    }

    const destAddress = document.getElementById("destSelectedAddress").value;
    if (!destAddress) {
      return this.showFieldValidationError("destSearchInput", "Destination Location Required", "Please select a destination / delivery location on the map or search!");
    }
    const destDetails = document.getElementById("destAddressDetails").value.trim();
    if (!destDetails) {
      return this.showFieldValidationError("destAddressDetails", "Destination Details Required", "Please enter the specific Manual Address Details for Destination / Delivery (e.g. Receiving Area, Warehouse Unit, Contact Info)!");
    }

    const cargoVal = document.getElementById("createCargoValue").value;
    if (!cargoVal || parseFloat(cargoVal) <= 0) {
      return this.showFieldValidationError("createCargoValue", "Declared Value Required", "Please enter the declared cargo value in RM (e.g. 25000)!");
    }

    const cargoWeight = document.getElementById("createWeight").value;
    if (!cargoWeight || parseFloat(cargoWeight) <= 0) {
      return this.showFieldValidationError("createWeight", "Cargo Weight Required", "Please enter the cargo weight in kg!");
    }

    const cargoDistance = document.getElementById("createDistance").value;
    if (!cargoDistance || parseFloat(cargoDistance) <= 0) {
      return this.showFieldValidationError("createDistance", "Transit Distance Required", "Please calculate the route distance using the maps or enter the transit distance in km (minimum 5 km)!");
    }
    if (parseFloat(cargoDistance) < 5) {
      return this.showFieldValidationError("createDistance", "Invalid Distance", "Transit distance must be at least 5 km!");
    }

    if (!totalEthStr || parseFloat(totalEthStr) <= 0) {
      return this.showFieldValidationError("createDistance", "Invalid Escrow Amount", "Calculated escrow payment must be greater than 0 ETH. Please ensure distance and weight are entered!");
    }

    const photoInput = document.getElementById("createCargoPhotoInput");
    if (!photoInput || !photoInput.files || photoInput.files.length === 0) {
      return this.showFieldValidationError("createCargoPhotoInput", "Inspection Photo Required", "Please upload an initial cargo condition inspection photo proof before dispatching!");
    }

    const originDisplay = `${originAddress} || Details: ${originDetails}`;
    const destDisplay = `${destAddress} || Details: ${destDetails}`;
    const declaredValNum = parseInt(cargoVal) || 25000;

    try {
      // 1. Upload initial photo to IPFS service
      this.showTxLoading("Uploading Cargo Proof", "Pinning cargo condition photograph to decentralized IPFS Cloud...", "Decentralized storage via Pinata", btn);
      let ipfsPhotoCid = "";
      const fd = new FormData();
      fd.append("photo", photoInput.files[0]);
      
      const upRes = await fetch("/api/upload-ipfs", { method: "POST", body: fd });
      const upData = await upRes.json();
      if (!upRes.ok || !upData || !upData.cid) {
        throw new Error(upData.error || "Pinata IPFS upload failed");
      }
      ipfsPhotoCid = upData.cid;
      console.log("[IPFS] Cargo condition photo uploaded with CID:", ipfsPhotoCid);

      // 2. Dispatch on-chain agreement with CargoSpec struct
      const cargoSpec = [
        cargoDesc,
        originDisplay,
        destDisplay,
        ipfsPhotoCid,
        declaredValNum
      ];

      const weiVal = this.web3.utils.toWei(totalEthStr, "ether");

      this.showTxLoading("Depositing Escrow Funds", `Please confirm the transaction in MetaMask to lock ${totalEthStr} ETH in escrow...`, "Smart contract will lock funds until milestones are approved", btn);
      await this.escrowContract.methods.createAgreement(
        carrier,
        deadlineTimestamp,
        cargoSpec
      ).send({
        from: this.account,
        value: weiVal
      });

      this.showToast("Agreement Dispatched", `Freight Agreement dispatched on-chain with ${totalEthStr} ETH locked in escrow!`, "success", 5000);
      
      // Close creation panel and clear all form inputs for next time
      if (this.isCreatePanelOpen) {
        this.toggleCreateAgreementPanel();
      }
      this.clearCreateAgreementForm();

      await this.refreshUI();
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Creation Cancelled", "Escrow deposit signature was rejected in MetaMask.", "cancel");
      } else {
        this.showToast("Creation Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  onShipperSearchChange: function (term) {
    this.shipperSearchTerm = (term || "").trim().toLowerCase();
    this.renderShipperView();
  },

  filterShipperContracts: function (status, btn) {
    this.shipperFilter = status;
    document.querySelectorAll("#view-shipper .filter-pill-btn").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    this.renderShipperView();
  },

  sortShipperContracts: function () {
    this.shipperSort = document.getElementById("shipperSortSelect").value;
    this.renderShipperView();
  },

  // ================= CARRIER HUB FUNCTIONS =================
  filterCarrierTasks: function (status, btn) {
    this.carrierFilter = status;
    document.querySelectorAll("#view-carrier-tasks .filter-pill-btn").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    this.renderCarrierTasksView();
  },
  sortCarrierTasks: function () {
    this.carrierSort = document.getElementById("carrierSortSelect").value;
    this.renderCarrierTasksView();
  },

  acceptCarrierShipment: async function (id, btn) {
    try {
      this.showTxLoading("Accepting Freight Contract", `Confirming acceptance of Freight Contract #${id} in MetaMask...`, "Locks freight contract to your fleet", btn);
      await this.escrowContract.methods.acceptAgreement(id).send({ from: this.account });
      try {
        localStorage.setItem(`carrier_accepted_${id}`, "true");
      } catch (storageErr) {}
      this.showToast("Task Accepted", `Accepted Freight Contract #${id}! Agreement is now [Pickup Required].`, "success");
      this.hideShipmentDetailModal();
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Acceptance Cancelled", "Contract acceptance signature was rejected in MetaMask.", "cancel");
      } else {
        this.showToast("Acceptance Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  rejectCarrierShipment: async function (id, btn) {
    const ok = await this.showConfirmDialog({
      title: "Reject Freight Contract",
      icon: "❌",
      message: `Reject Freight Contract #${id}?\n\nThere is no penalty to your fleet, and the escrow deposit will be 100% refunded to the shipper.`,
      okText: "Yes, Reject Contract",
      cancelText: "Keep Contract",
      okBtnClass: "btn-danger"
    });
    if (!ok) {
      this.showToast("Action Cancelled", "Contract rejection cancelled.", "cancel");
      return;
    }

    try {
      this.showTxLoading("Rejecting Freight Contract", `Processing rejection of Contract #${id} in MetaMask...`, "100% escrow will be returned to shipper", btn);
      await this.escrowContract.methods.rejectAgreement(id).send({ from: this.account });
      this.showToast("Contract Rejected", `Freight Contract #${id} rejected. 100% escrow refunded to shipper.`, "cancel");
      this.hideShipmentDetailModal();
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Rejection Cancelled", "MetaMask signature request was cancelled.", "cancel");
      } else {
        this.showToast("Rejection Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  hideCarrierProofModal: function () {
    const modalEl = document.getElementById("carrierProofUploadModal");
    if (modalEl) {
      if (typeof bootstrap !== "undefined" && bootstrap.Modal) {
        const modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
        if (modal) modal.hide();
      }
      modalEl.classList.remove("show");
      modalEl.style.display = "none";
      modalEl.setAttribute("aria-hidden", "true");
    }
    document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());
    document.body.classList.remove("modal-open");
    document.body.style.removeProperty("overflow");
    document.body.style.removeProperty("padding-right");
  },

  openCarrierProofModal: function (id, msIndex) {
    const ag = this.allAgreements.find(a => String(a.id) === String(id));
    if (!ag) return alert("Agreement #" + id + " not found.");

    document.getElementById("carrierProofAgreementId").value = id;
    document.getElementById("carrierProofMsIndex").value = msIndex;
    document.getElementById("carrierProofTargetAgreement").innerText = ag.cargoTitle || `Freight Contract #${id}`;
    
    const targetBadge = document.getElementById("carrierProofTargetMilestone");
    const desc = document.getElementById("carrierProofDescription");
    const eth30Str = this.formatPercentAmount(ag.totalValue, 30);
    const eth70Str = this.formatPercentAmount(ag.totalValue, 70);

    if (msIndex === 0) {
      const nowSec = this.getNowSec();
      const isOverdue = ag.deadline && nowSec > parseInt(ag.deadline);
      targetBadge.className = isOverdue ? "badge bg-warning text-dark fw-bold" : "badge bg-primary";
      targetBadge.innerText = isOverdue ? "Milestone 1: Late Cargo Pickup (0 ETH • Overdue)" : `Milestone 1: Cargo Pickup Verification (${eth30Str})`;
      desc.innerText = isOverdue ?
        "Capture physical inspection photo at origin loading dock. (Note: Because delivery deadline has expired before pickup, 0 ETH escrow is disbursed, but +50 CRT reputation will be earned upon shipper validation)." :
        "Capture physical inspection photo at origin loading dock before departure to verify packaging integrity (+50 CRT).";
    } else {
      const nowSec = this.getNowSec();
      const isOverdue = (ag.deadline && nowSec > parseInt(ag.deadline)) || parseInt(ag.status) === 4;
      targetBadge.className = isOverdue ? "badge bg-warning text-dark fw-bold" : "badge bg-success";
      targetBadge.innerText = isOverdue ? "Milestone 2: Late Delivery Sign-off (0 ETH • Overdue)" : `Milestone 2: Final Delivery Sign-off (${eth70Str})`;
      desc.innerText = isOverdue ?
        "Capture photo of recipient sign-off / arrival at destination. (Note: Because delivery deadline has expired, no remaining escrow will be disbursed (0 ETH), but completing this late delivery will recover +100 CRT to your carrier reputation score)." :
        "Capture photo of recipient sign-off / arrival at destination unloader to request final settlement (+100 CRT).";
    }

    const rejInfo = msIndex === 0 ? ag.ms1Rejection : ag.ms2Rejection;
    const rejAlert = document.getElementById("carrierProofRejectionAlert");
    const rejText = document.getElementById("carrierProofRejectionReasonText");
    const prevPhotoBtnContainer = document.getElementById("carrierProofPrevPhotoBtnContainer");
    const prevPhotoBtn = document.getElementById("carrierProofViewPrevPhotoBtn");

    if (rejAlert) {
      if (rejInfo && rejInfo.rejected) {
        rejAlert.classList.remove("d-none");
        if (rejText) rejText.innerText = rejInfo.reason ? `"${rejInfo.reason}"` : "Shipper requested a clearer inspection photo.";
        if (rejInfo.lastProof && prevPhotoBtnContainer && prevPhotoBtn) {
          prevPhotoBtnContainer.classList.remove("d-none");
          prevPhotoBtn.onclick = () => App.showIpfsModal(rejInfo.lastProof, 'Previously Rejected Photo');
        } else if (prevPhotoBtnContainer) {
          prevPhotoBtnContainer.classList.add("d-none");
        }
      } else {
        rejAlert.classList.add("d-none");
      }
    }

    const fileInput = document.getElementById("carrierProofFileInput");
    if (fileInput) fileInput.value = "";
    document.getElementById("carrierProofPreviewContainer").classList.add("d-none");
    document.getElementById("carrierProofUploadStatus").classList.add("d-none");
    document.getElementById("btnSubmitCarrierProof").disabled = false;

    const modalEl = document.getElementById("carrierProofUploadModal");
    if (modalEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  },

  onCarrierProofFileSelected: function (event) {
    const file = event.target.files[0];
    const previewContainer = document.getElementById("carrierProofPreviewContainer");
    const previewImg = document.getElementById("carrierProofPreviewImg");
    const fileName = document.getElementById("carrierProofFileName");

    if (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        previewImg.src = e.target.result;
        previewContainer.classList.remove("d-none");
        fileName.innerText = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      };
      reader.readAsDataURL(file);
    } else {
      previewContainer.classList.add("d-none");
    }
  },

  submitCarrierMilestoneProof: async function () {
    const id = document.getElementById("carrierProofAgreementId").value;
    const msIndex = parseInt(document.getElementById("carrierProofMsIndex").value);
    const fileInput = document.getElementById("carrierProofFileInput");

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      this.showToast("Missing Photo", "Please select an inspection photo to upload!", "error");
      if (fileInput) {
        fileInput.classList.add("form-field-invalid");
        fileInput.focus();
        fileInput.addEventListener("change", () => fileInput.classList.remove("form-field-invalid"), { once: true });
      }
      return;
    }

    const submitBtn = document.getElementById("btnSubmitCarrierProof");
    const msTitle = msIndex === 0 ? "Pickup" : "Delivery";

    try {
      // Step 1: Upload photo to Pinata IPFS via /api/upload-ipfs
      this.showTxLoading(`Uploading ${msTitle} Proof`, "Pinning inspection photo to decentralized Pinata IPFS Cloud...", "Decentralized storage via Pinata", submitBtn);
      const formData = new FormData();
      formData.append("photo", fileInput.files[0]);

      const uploadRes = await fetch("/api/upload-ipfs", {
        method: "POST",
        body: formData
      });

      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.cid) {
        throw new Error(uploadData.error || "Pinata IPFS upload failed");
      }

      const finalCid = uploadData.cid;
      console.log("Photo pinned to IPFS CID:", finalCid);

      // Step 2: Submit to smart contract
      this.showTxLoading(`Recording ${msTitle} Proof`, "Confirming transaction in MetaMask to record proof on-chain...", "Awaiting local EVM ledger update", submitBtn);
      await this.escrowContract.methods.submitMilestoneProof(id, msIndex, finalCid).send({ from: this.account });

      this.showToast("Proof Recorded", `Milestone ${msIndex + 1} (${msTitle}) proof recorded on blockchain!`, "success");
      
      // Auto close modal & detail modal
      this.hideCarrierProofModal();
      this.hideShipmentDetailModal();

      // Refresh UI while remaining on the current tab (Assigned Freight Tasks)
      await this.refreshUI();
    } catch (err) {
      console.error("Milestone proof submission error:", err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Submission Cancelled", "Proof submission transaction was rejected in MetaMask.", "cancel");
      } else {
        this.showToast("Submission Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(submitBtn);
    }
  },

  validatePickupAndClaimRefund: async function (id, btn) {
    const ag = this.allAgreements.find(a => String(a.id) === String(id));
    const eth30Str = ag ? this.formatPercentAmount(ag.totalValue, 30) : "30%";
    const eth70Str = ag ? this.formatPercentAmount(ag.totalValue, 70) : "70%";
    const eth100Str = ag ? this.formatPercentAmount(ag.totalValue, 100) : "100%";

    const isOnTime = ag && ag.ms1SubmittedOnTime;

    const confirmPrompt = isOnTime ?
      `Carrier submitted pickup proof before expiration, but delivery deadline is now expired.\n\nValidate cargo pickup (releases ${eth30Str} & +50 CRT to carrier) AND claim remaining 70% overdue escrow refund (${eth70Str}) back to your wallet?\n\n(Carrier reputation will be penalized 300 CRT for missing the delivery deadline. The carrier can then proceed with late delivery to earn back +100 CRT upon completion, resulting in a net penalty of only 150 CRT).` :
      `Carrier submitted pickup proof LATE (after the delivery deadline expired).\n\nValidate late cargo pickup and claim 100% escrow refund (${eth100Str}) back to your wallet?\n\n(Carrier receives 0 ETH payout, is penalized 300 CRT for missing deadline, but earns back +50 CRT for fulfilling pickup. The carrier can then complete late delivery to earn back another +100 CRT, reducing their net penalty to 150 CRT).`;
    
    const ok = await this.showConfirmDialog({
      title: isOnTime ? "Validate On-Time Pickup & Claim 70% Refund" : "Validate Late Pickup & Claim 100% Refund",
      icon: "🚚",
      message: confirmPrompt,
      okText: isOnTime ? "Validate & Claim 70% Refund" : "Validate & Claim 100% Refund",
      cancelText: "Cancel",
      okBtnClass: "btn-warning"
    });
    if (!ok) {
      this.showToast("Action Cancelled", "Operation cancelled by user.", "cancel");
      return;
    }

    try {
      this.showTxLoading(
        isOnTime ? "Validating On-Time Pickup & Refunding 70%" : "Validating Late Pickup & Refunding 100%",
        "Confirming transaction in MetaMask...",
        isOnTime ? "Smart contract disburses 30% and refunds 70%" : "Smart contract disburses 0 ETH to carrier and refunds 100% to shipper",
        btn
      );
      await this.escrowContract.methods.validatePickupAndClaimTimeoutRefund(id).send({ from: this.account });
      this.showToast(
        "Pickup Validated",
        isOnTime ? `Pickup validated (${eth30Str} paid) & 70% refund (${eth70Str}) claimed!` : `Late pickup validated (0 ETH to carrier) & 100% refund (${eth100Str}) claimed!`,
        "success",
        5000
      );
      this.hideShipmentDetailModal();
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Transaction Cancelled", "Transaction signature request was cancelled.", "cancel");
      } else {
        this.showToast("Transaction Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  claimTimeoutRefund: async function (id, btn) {
    const ag = this.allAgreements.find(a => String(a.id) === String(id));
    const isPickupDone = ag && ag.ms1 && ag.ms1.completed;
    const eth70Str = ag ? this.formatPercentAmount(ag.totalValue, 70) : "70%";
    const eth100Str = ag ? this.formatPercentAmount(ag.totalValue, 100) : "100%";

    const confirmPrompt = isPickupDone ?
      `Cargo was picked up, but carrier missed the delivery completion deadline.\n\nClaim remaining 70% escrow refund (${eth70Str}) back to your wallet?\n\n(Carrier reputation will be penalized 300 CRT for missing the deadline, but they can still earn back +100 CRT by submitting late delivery sign-off).` :
      `Cancel Freight Contract #${id} & claim 100% escrow refund (${eth100Str}) due to missed pickup deadline?\n\nThis will disburse remaining funds to your wallet and slash 300 CRT from the carrier's reputation score for abandoning the assigned shipment.`;

    const ok = await this.showConfirmDialog({
      title: isPickupDone ? "Claim 70% Overdue Escrow Refund" : "Cancel Shipment (Carrier Missed Pickup)",
      icon: "⏰",
      message: confirmPrompt,
      okText: isPickupDone ? "Claim 70% Refund" : "Cancel & Claim 100% Refund",
      cancelText: "Cancel",
      okBtnClass: "btn-danger"
    });
    if (!ok) {
      this.showToast("Action Cancelled", "Refund claim was cancelled by user.", "cancel");
      return;
    }

    try {
      this.showTxLoading("Claiming Overdue Escrow Refund", "Confirming refund transaction in MetaMask...", "Escrow funds return to your wallet", btn);
      await this.escrowContract.methods.claimTimeoutRefund(id).send({ from: this.account });
      
      this.lastRefundedAgreement = ag;
      this.showToast("Refund Processed", isPickupDone ? `Claimed 70% overdue escrow refund (${eth70Str})!` : `Freight Contract #${id} cancelled & 100% escrow refunded!`, "success", 5000);
      this.hideShipmentDetailModal();
      await this.refreshUI();

      if (!isPickupDone && ag) {
        // Missed pickup: automatically display Reschedule Prompt Dialog
        const titleEl = document.getElementById("rescheduleModalCargoTitle");
        if (titleEl) titleEl.innerHTML = `Cargo: <b>${ag.cargoTitle || `Freight Contract #${id}`}</b> (Refunded: ${parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4)} ETH)`;
        const reschedModal = document.getElementById("rescheduleShipmentModal");
        if (reschedModal && typeof bootstrap !== "undefined" && bootstrap.Modal) {
          bootstrap.Modal.getOrCreateInstance(reschedModal).show();
        }
      }
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Transaction Cancelled", "Refund transaction was cancelled in MetaMask.", "cancel");
      } else {
        this.showToast("Refund Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  validateLateDelivery: async function (id, btn) {
    const ag = this.allAgreements.find(a => String(a.id) === String(id));
    const hasRemaining = ag && BigInt(ag.remainingBalance || 0) > BigInt(0);
    const eth70Str = ag ? this.formatPercentAmount(ag.totalValue, 70) : "70%";

    const title = hasRemaining ?
      "Claim 70% Escrow Refund & Validate Late Delivery" :
      "Validate Late Delivery Done";

    const confirmMsg = hasRemaining ?
      `The carrier submitted late delivery proof after the delivery deadline expired.\n\nValidate cargo receipt for Freight Contract #${id}?\n\n1. Remaining 70% escrow refund (${eth70Str}) will be disbursed back to your wallet.\n2. Cargo arrival is confirmed and agreement marked as Completed.\n3. Carrier receives 0 ETH payout, gets penalized 300 CRT for missing deadline, but earns back +100 CRT for completing late delivery (net penalty 150 CRT if pickup was completed).` :
      `Validate that you have safely received cargo for Freight Contract #${id}?\n\nThis will confirm delivery completion. No ETH funds will be sent to the carrier (remaining escrow was refunded), but the carrier will earn +100 CRT for safely completing late delivery.`;

    const ok = await this.showConfirmDialog({
      title,
      icon: "✅",
      message: confirmMsg,
      okText: hasRemaining ? "Claim 70% & Validate Complete" : "Validate Late Delivery Done",
      cancelText: "Cancel",
      okBtnClass: "btn-success"
    });
    if (!ok) {
      this.showToast("Action Cancelled", "Validation was cancelled by user.", "cancel");
      return;
    }

    try {
      this.showTxLoading("Validating Delivery Receipt", "Confirming late delivery validation in MetaMask...", "Smart contract settlement & completion", btn);
      await this.escrowContract.methods.validateLateDelivery(id).send({ from: this.account });
      this.showToast("Delivery Validated", "Late delivery receipt validated! Shipment marked as Completed.", "success");
      this.hideShipmentDetailModal();
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Validation Cancelled", "Validation was cancelled in MetaMask.", "cancel");
      } else {
        this.showToast("Validation Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  confirmReschedule: async function () {
    const reschedModal = document.getElementById("rescheduleShipmentModal");
    if (reschedModal && typeof bootstrap !== "undefined" && bootstrap.Modal) {
      bootstrap.Modal.getInstance(reschedModal)?.hide();
    }
    const ag = this.lastRefundedAgreement;
    if (!ag) return;

    // 1. Open creation form if not already open
    if (!this.isCreatePanelOpen) {
      this.toggleCreateAgreementPanel();
    }

    // Refresh map layout
    this.invalidateAllMaps();

    // 2. Pre-fill cargo fields
    const descEl = document.getElementById("createCargoDesc");
    const valEl = document.getElementById("createCargoValue");
    const weightEl = document.getElementById("createWeight");

    if (descEl) descEl.value = ag.cargoTitle || "";
    if (valEl) valEl.value = ag.declaredValue || "25000";
    if (weightEl) weightEl.value = "1000";

    // 3. Parse and auto-fill origin & destination addresses + manual details
    const originParsed = this.parseAddressAndDetails(ag.origin);
    const originDetEl = document.getElementById("originAddressDetails");
    if (originDetEl) originDetEl.value = originParsed.details === "None provided" ? "" : originParsed.details;

    const destParsed = this.parseAddressAndDetails(ag.dest);
    const destDetEl = document.getElementById("destAddressDetails");
    if (destDetEl) destDetEl.value = destParsed.details === "None provided" ? "" : destParsed.details;

    // Helper to extract Lat/Lng or geocode
    const extractCoords = (addrStr) => {
      if (!addrStr) return null;
      const match = addrStr.match(/Lat:\s*([-\d.]+),\s*Lng:\s*([-\d.]+)/i);
      if (match) {
        return [parseFloat(match[1]), parseFloat(match[2])];
      }
      return null;
    };

    const originCoords = extractCoords(originParsed.address);
    if (originCoords) {
      const cleanOriginLabel = originParsed.address.replace(/\s*\(Lat:.*?\)/i, "").trim();
      this.setOriginLocation(originCoords[0], originCoords[1], cleanOriginLabel);
    } else {
      await this.geocodeAndPin(originParsed.address, "origin");
    }

    const destCoords = extractCoords(destParsed.address);
    if (destCoords) {
      const cleanDestLabel = destParsed.address.replace(/\s*\(Lat:.*?\)/i, "").trim();
      this.setDestLocation(destCoords[0], destCoords[1], cleanDestLabel);
    } else {
      await this.geocodeAndPin(destParsed.address, "dest");
    }

    // 4. Update highway route overview and recalculate distance & quote
    this.updateOverviewMap();
    this.recalculateMapDistance();
    this.recalculateShipperQuote();

    // 5. Carrier dropdown MUST NOT be auto-selected
    const carrierSelect = document.getElementById("shipperCarrierSelect");
    if (carrierSelect) {
      carrierSelect.value = "";
      this.onCarrierSelectChange();
    }

    // 6. Scroll smoothly to creation form
    const container = document.getElementById("createAgreementContainer");
    if (container) container.scrollIntoView({ behavior: "smooth" });

    this.showToast("Reschedule Loaded", "Cargo parameters loaded. Please choose a new carrier fleet and specify a deadline.", "info");
  },

  reactivateCarrierStake: async function (btn) {
    const confirmMsg = "Deposit missing collateral back to 0.01 ETH to restore your active fleet standing?";
    const ok = await this.showConfirmDialog({
      title: "Reactivate Fleet Standing",
      icon: "💎",
      message: confirmMsg,
      okText: "Deposit 0.01 ETH Stake",
      cancelText: "Cancel",
      okBtnClass: "btn-warning"
    });
    if (!ok) {
      this.showToast("Action Cancelled", "Collateral deposit cancelled.", "cancel");
      return;
    }

    try {
      this.showTxLoading("Depositing Collateral Stake", "Confirming 0.01 ETH stake deposit in MetaMask...", "Restores active fleet status", btn);
      await this.escrowContract.methods.depositStake().send({
        from: this.account,
        value: this.web3.utils.toWei("0.01", "ether")
      });
      this.showToast("Stake Restored", "Security collateral successfully restored to 0.01 ETH! Profile is now active.", "success");
      await this.refreshUI();
    } catch (err) {
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Deposit Cancelled", "Stake deposit transaction was rejected in MetaMask.", "cancel");
      } else {
        this.showToast("Reactivation Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  withdrawCarrierStake: async function (btn) {
    const confirmMsg = "Withdraw your 0.01 ETH security stake and deregister from the shipper directory?";
    const ok = await this.showConfirmDialog({
      title: "Withdraw Security Stake",
      icon: "⚠️",
      message: confirmMsg,
      okText: "Withdraw 0.01 ETH",
      cancelText: "Keep Stake",
      okBtnClass: "btn-danger"
    });
    if (!ok) {
      this.showToast("Action Cancelled", "Stake withdrawal cancelled.", "cancel");
      return;
    }

    try {
      this.showTxLoading("Withdrawing Security Stake", "Confirming 0.01 ETH stake withdrawal in MetaMask...", "Returns collateral to wallet", btn);
      await this.escrowContract.methods.withdrawStake(this.web3.utils.toWei("0.01", "ether")).send({ from: this.account });
      this.showToast("Stake Withdrawn", "0.01 ETH security stake withdrawn to your wallet!", "success");
      await this.refreshUI();
    } catch (err) {
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Withdrawal Cancelled", "Stake withdrawal was cancelled in MetaMask.", "cancel");
      } else {
        this.showToast("Withdrawal Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  // ================= LOAD & RENDER CONTRACTS =================
  loadAgreements: async function () {
    if (!this.escrowContract) return;
    try {
      const total = await this.escrowContract.methods.totalAgreements().call();
      this.allAgreements = [];

      let acceptedAgreementIds = new Set();
      try {
        let fromBlock = 0;
        try {
          const latestBlock = await this.web3.eth.getBlockNumber();
          fromBlock = Math.max(0, Number(latestBlock) - 9999);
        } catch (bErr) {}
        const acceptedEvents = await this.escrowContract.getPastEvents("AgreementAccepted", {
          fromBlock: fromBlock,
          toBlock: "latest"
        });
        if (acceptedEvents && acceptedEvents.length > 0) {
          acceptedEvents.forEach(ev => {
            if (ev.returnValues && ev.returnValues.agreementId !== undefined) {
              acceptedAgreementIds.add(String(ev.returnValues.agreementId));
            }
          });
        }
      } catch (evErr) {
        console.warn("Could not query AgreementAccepted events:", evErr);
      }

      for (let i = 1; i <= parseInt(total); i++) {
        const ag = await this.escrowContract.methods.getAgreementDetails(i).call();
        const cargo = await this.escrowContract.methods.getAgreementCargo(i).call();
        const ms1 = await this.escrowContract.methods.getMilestoneDetails(i, 0).call();
        const ms2 = await this.escrowContract.methods.getMilestoneDetails(i, 1).call();

        let ms1SubTime = 0;
        let ms2SubTime = 0;
        try {
          if (this.escrowContract.methods.getMilestoneSubmissionTime) {
            ms1SubTime = parseInt(await this.escrowContract.methods.getMilestoneSubmissionTime(i, 0).call());
            ms2SubTime = parseInt(await this.escrowContract.methods.getMilestoneSubmissionTime(i, 1).call());
          }
        } catch (e) {}

        let ms1Rejection = { rejected: false, reason: "", lastProof: "" };
        let ms2Rejection = { rejected: false, reason: "", lastProof: "" };
        try {
          if (this.escrowContract.methods.getMilestoneRejectionInfo) {
            const r1 = await this.escrowContract.methods.getMilestoneRejectionInfo(i, 0).call();
            ms1Rejection = { rejected: Boolean(r1.rejected), reason: r1.reason || "", lastProof: r1.lastRejectedProof || "" };
            const r2 = await this.escrowContract.methods.getMilestoneRejectionInfo(i, 1).call();
            ms2Rejection = { rejected: Boolean(r2.rejected), reason: r2.reason || "", lastProof: r2.lastRejectedProof || "" };
          }
        } catch (e) {}

        const ms1SubmittedOnTime = ms1 && ms1.completed && ms1SubTime > 0 && ms1SubTime <= parseInt(ag.deadline);
        const ms2SubmittedOnTime = ms2 && ms2.completed && ms2SubTime > 0 && ms2SubTime <= parseInt(ag.deadline);

        let hasRefund = parseInt(ag.status) === 4 || parseInt(ag.status) === 6 || parseInt(ag.status) === 7;
        let isLate = false;
        try {
          if (this.escrowContract.methods.getAgreementStatusFlags) {
            const flags = await this.escrowContract.methods.getAgreementStatusFlags(i).call();
            if (flags.hasRefund) hasRefund = true;
            if (flags.isLate) isLate = true;
          }
        } catch (e) {
          // Fallback if flags not present
        }

        if (parseInt(ag.status) === 3 && (isLate || (ag.deadline && parseInt(ag.deadline) < this.getNowSec()))) {
          hasRefund = true;
          isLate = true;
        }

        const wasAccepted = acceptedAgreementIds.has(String(i)) || 
                            parseInt(ag.status) === 1 || 
                            parseInt(ag.status) === 2 || 
                            parseInt(ag.status) === 3 || 
                            parseInt(ag.status) === 4 ||
                            Boolean(ms1 && (ms1.completed || ms1.approved)) ||
                            Boolean(ms2 && (ms2.completed || ms2.approved)) ||
                            (localStorage.getItem(`carrier_accepted_${i}`) === "true");

        this.allAgreements.push({
          id: ag.id,
          shipper: ag.shipper,
          carrier: ag.carrier,
          totalValue: ag.totalValue,
          remainingBalance: ag.remainingBalance,
          deadline: ag.deadline,
          status: ag.status,
          cargoTitle: cargo.cargoTitle || `Freight Contract #${i}`,
          origin: cargo.originLocation || "Origin Hub",
          dest: cargo.destLocation || "Destination Hub",
          initialPhotoIpfs: cargo.initialPhotoIpfs || "QmDefaultCargoProof",
          declaredValue: cargo.declaredValue || "25000",
          hasRefund,
          isLate,
          ms1,
          ms1SubTime,
          ms1SubmittedOnTime,
          ms1Rejection,
          ms2,
          ms2SubTime,
          ms2SubmittedOnTime,
          ms2Rejection,
          wasAccepted
        });
      }

      this.renderShipperView();
      this.renderCarrierProfileView();
      this.renderCarrierTasksView();
      this.renderLedgerTable(this.allAgreements);
    } catch (err) {
      console.error("Error loading agreements:", err);
    }
  },

  updateShipperFilterBadges: function () {
    if (!this.allAgreements || !this.account) return;
    const myAgreements = this.allAgreements.filter(ag => ag.shipper && ag.shipper.toLowerCase() === this.account.toLowerCase());

    const pendingCount = myAgreements.filter(ag => parseInt(ag.status) === 0).length;
    // Pickup Required includes status === 1 while milestone 1 is not approved
    const pickupCount = myAgreements.filter(ag => parseInt(ag.status) === 1 && (!ag.ms1 || !ag.ms1.approved)).length;
    const transitCount = myAgreements.filter(ag => parseInt(ag.status) === 2 || (parseInt(ag.status) === 4 && ag.ms1 && ag.ms1.completed && (!ag.ms2 || !ag.ms2.approved))).length;
    const completedCount = myAgreements.filter(ag => parseInt(ag.status) === 3).length;
    const cancelledCount = myAgreements.filter(ag => parseInt(ag.status) === 6 || (parseInt(ag.status) === 4 && (!ag.ms1 || !ag.ms1.completed))).length;
    const refundedCount = myAgreements.filter(ag => {
      const sIdx = parseInt(ag.status);
      return sIdx === 4 || sIdx === 6 || sIdx === 7 || ag.hasRefund || ag.isLate || ag.isLateCompleted;
    }).length;

    const setBadge = (id, count) => {
      const el = document.getElementById(id);
      if (el) {
        el.innerText = count;
        if (count > 0) el.classList.remove("d-none");
        else el.classList.add("d-none");
      }
    };

    setBadge("shipperBadgePending", pendingCount);
    setBadge("shipperBadgePickup", pickupCount);
    setBadge("shipperBadgeTransit", transitCount);
    setBadge("shipperBadgeCompleted", completedCount);
    setBadge("shipperBadgeCancelled", cancelledCount);
    setBadge("shipperBadgeRefunded", refundedCount);
  },

  renderShipperView: function () {
    const container = document.getElementById("shipperShipmentsList");
    if (!container) return;

    this.updateShipperFilterBadges();

    let items = this.allAgreements.filter(ag => ag.shipper.toLowerCase() === this.account.toLowerCase());

    const statusNames = ["PendingAcceptance", "PickupRequired", "InTransit", "Completed", "Refunded", "Disputed", "Cancelled", "Rejected"];

    if (this.shipperFilter !== "ALL") {
      items = items.filter(ag => {
        const sIdx = parseInt(ag.status);
        const hasRefund = ag.hasRefund || sIdx === 4 || sIdx === 6 || sIdx === 7 || ag.isLate || ag.isLateCompleted;
        const isCompleted = sIdx === 3;
        const isCancelled = sIdx === 6 || (sIdx === 4 && (!ag.ms1 || !ag.ms1.completed));
        const isInTransit = sIdx === 2 || (sIdx === 4 && ag.ms1 && ag.ms1.completed && (!ag.ms2 || !ag.ms2.approved));

        if (this.shipperFilter === "PendingAcceptance") return sIdx === 0;
        if (this.shipperFilter === "PickupRequired") return sIdx === 1 && (!ag.ms1 || !ag.ms1.approved);
        if (this.shipperFilter === "InTransit") return isInTransit;
        if (this.shipperFilter === "Completed") return isCompleted;
        if (this.shipperFilter === "Cancelled") return isCancelled;
        if (this.shipperFilter === "Refunded") return hasRefund;
        return (statusNames[sIdx] || "PendingAcceptance") === this.shipperFilter;
      });
    }

    if (this.shipperSearchTerm) {
      items = items.filter(ag => {
        const title = (ag.cargoTitle || "").toLowerCase();
        const idStr = String(ag.id);
        const origin = (ag.origin || "").toLowerCase();
        const dest = (ag.dest || "").toLowerCase();
        return title.includes(this.shipperSearchTerm) || idStr.includes(this.shipperSearchTerm) || origin.includes(this.shipperSearchTerm) || dest.includes(this.shipperSearchTerm);
      });
    }

    if (this.shipperSort === "oldest") {
      items.sort((a, b) => a.id - b.id);
    } else if (this.shipperSort === "valueHigh") {
      items.sort((a, b) => BigInt(b.totalValue) > BigInt(a.totalValue) ? 1 : -1);
    } else if (this.shipperSort === "deadlineSoon") {
      items.sort((a, b) => parseInt(a.deadline) - parseInt(b.deadline));
    } else if (this.shipperSort === "deadlineLate") {
      items.sort((a, b) => parseInt(b.deadline) - parseInt(a.deadline));
    } else {
      items.sort((a, b) => b.id - a.id);
    }

    if (items.length === 0) {
      const searchNotice = this.shipperSearchTerm ? 
        `No freight agreements found matching "<b>${this.shipperSearchTerm}</b>".` :
        "You haven't created any freight escrow contracts matching this filter yet.";

      container.innerHTML = `
        <div class="text-center py-5 glass-card">
          <div class="display-6 mb-2">📦</div>
          <h5 class="text-white fw-bold mb-1">No Shipment Agreements Found</h5>
          <p class="text-muted small mb-3">${searchNotice}</p>
          <button class="btn btn-primary btn-glow btn-sm px-4" onclick="App.toggleCreateAgreementPanel()">➕ Create New Shipment Agreement</button>
        </div>
      `;
      return;
    }

    let html = "";
    items.forEach(ag => {
      const statusIdx = parseInt(ag.status);
      const statusDisplay = this.getStatusDisplay(ag);
      const totalEth = parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4);
      const myrVal = (totalEth * this.ethToMyrRate).toFixed(2);
      const deadlineDate = new Date(parseInt(ag.deadline) * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

      const nowSec = this.getNowSec();
      const isPastDeadline = ag.deadline && nowSec > parseInt(ag.deadline);
      const isLateOrRefunded = isPastDeadline || statusIdx === 4;
      const hasRemainingEscrow = BigInt(ag.remainingBalance || 0) > BigInt(0);

      const originParsed = this.parseAddressAndDetails(ag.origin);
      const destParsed = this.parseAddressAndDetails(ag.dest);

      const eth30Str = this.formatPercentAmount(ag.totalValue, 30);
      const eth70Str = this.formatPercentAmount(ag.totalValue, 70);
      const eth100Str = this.formatPercentAmount(ag.totalValue, 100);

      let actionButtons = "";
      if (statusIdx === 6) {
        // Cancelled shipment: NO dispute button, NO transit overdue button
        actionButtons += `<span class="badge bg-danger bg-opacity-25 border border-danger text-danger px-3 py-1 fw-bold">🛑 Cancelled & Refunded (${eth100Str})</span>`;
      } else if (isLateOrRefunded) {
        if (statusIdx === 0) {
          // Carrier never accepted and deadline expired -> shipper cancels offer with 100% refund, 0 carrier penalty
          actionButtons += `<button class="btn btn-sm btn-outline-danger me-2 fw-bold" onclick="event.stopPropagation(); App.cancelAgreement(${ag.id}, this)">⏰ Cancel Expired Offer & Claim Refund (${eth100Str})</button>`;
        } else if (statusIdx === 1 && (!ag.ms1 || !ag.ms1.completed)) {
          // Carrier accepted, but missed pickup deadline
          if (hasRemainingEscrow && statusIdx !== 4 && statusIdx !== 7) {
            actionButtons += `<button class="btn btn-sm btn-danger me-2 fw-bold shadow-sm" onclick="event.stopPropagation(); App.cancelMissedPickupShipment(${ag.id}, this)">❌ Cancel Shipment & Claim Refund (${eth100Str} • Carrier Missed Pickup)</button>`;
          }
        } else if (statusIdx === 1 && ag.ms1 && ag.ms1.completed && !ag.ms1.approved) {
          if (ag.ms1SubmittedOnTime) {
            // Carrier submitted pickup proof before expiration, but delivery deadline expired before shipper validated
            actionButtons += `<button class="btn btn-sm btn-warning me-2 fw-bold shadow-sm text-dark" onclick="event.stopPropagation(); App.validatePickupAndClaimRefund(${ag.id}, this)">🚚 Validate On-Time Pickup (${eth30Str}) & Claim 70% Refund (${eth70Str})</button>`;
          } else {
            // Carrier submitted pickup proof LATE after deadline: 0 ETH to carrier, 100% refund to shipper
            actionButtons += `<button class="btn btn-sm btn-warning me-2 fw-bold shadow-sm text-dark" onclick="event.stopPropagation(); App.validatePickupAndClaimRefund(${ag.id}, this)">🚚 Validate Late Pickup & Claim 100% Refund (${eth100Str})</button>`;
          }
        } else {
          // Pickup completed: cargo is in transit or late delivery
          if (ag.ms2 && ag.ms2.completed && !ag.ms2.approved) {
            if (ag.ms2SubmittedOnTime) {
              // Fair: submitted on or before deadline, so shipper approves normally!
              actionButtons += `<button class="btn btn-sm btn-success me-2 fw-bold shadow-sm" onclick="event.stopPropagation(); App.approveMilestone(${ag.id}, 1, this)">✅ Approve Delivery (Release ${eth70Str})</button>`;
              actionButtons += `<button class="btn btn-sm btn-outline-danger me-2 fw-bold shadow-sm" onclick="event.stopPropagation(); App.openRejectMilestoneModal(${ag.id}, 1)">❌ Reject Submission</button>`;
            } else {
              // Carrier submitted late delivery proof
              if (hasRemainingEscrow) {
                actionButtons += `<button class="btn btn-sm btn-success me-2 fw-bold shadow-sm" onclick="event.stopPropagation(); App.validateLateDelivery(${ag.id}, this)">💰 Claim 70% Refund (${eth70Str}) & Validate Late Delivery Done</button>`;
              } else {
                actionButtons += `<button class="btn btn-sm btn-success me-2 fw-bold shadow-sm" onclick="event.stopPropagation(); App.validateLateDelivery(${ag.id}, this)">✅ Validate Late Delivery Done (Confirm Cargo Received)</button>`;
              }
              actionButtons += `<button class="btn btn-sm btn-outline-danger me-2 fw-bold shadow-sm" onclick="event.stopPropagation(); App.openRejectMilestoneModal(${ag.id}, 1)">❌ Reject Submission</button>`;
            }
          } else if (!ag.ms2 || !ag.ms2.completed) {
            if (hasRemainingEscrow && statusIdx !== 4 && statusIdx !== 3) {
              actionButtons += `<button class="btn btn-sm btn-danger me-2 fw-bold shadow-sm" onclick="event.stopPropagation(); App.claimTimeoutRefund(${ag.id}, this)">⏰ Claim 70% Overdue Escrow Refund (${eth70Str})</button>`;
            }
            if (statusIdx === 4) {
              actionButtons += `<span class="badge bg-warning bg-opacity-25 border border-warning text-warning px-2 py-1 me-2 fw-bold">⚠️ Overdue Escrow Refunded • Awaiting Late Delivery</span>`;
            } else {
              actionButtons += `<span class="badge bg-warning bg-opacity-25 border border-warning text-warning px-2 py-1 me-2 fw-bold">⚠️ Delivery Overdue — Carrier In Transit</span>`;
            }
          }
        }
      } else {
        if (statusIdx === 0) {
          actionButtons += `<button class="btn btn-sm btn-outline-danger me-2" onclick="event.stopPropagation(); App.cancelAgreement(${ag.id}, this)">❌ Cancel Agreement (${eth100Str})</button>`;
        }
        if (statusIdx === 1 && (!ag.ms1 || !ag.ms1.completed)) {
          actionButtons += `<button class="btn btn-sm btn-outline-danger me-2" onclick="event.stopPropagation(); App.cancelAgreement(${ag.id}, this)">❌ Cancel Before Pickup (${eth100Str})</button>`;
        }
        if (statusIdx === 1 && ag.ms1 && ag.ms1.completed && !ag.ms1.approved) {
          actionButtons += `<button class="btn btn-sm btn-primary me-2" onclick="event.stopPropagation(); App.approveMilestone(${ag.id}, 0, this)">✅ Approve Pickup (Release ${eth30Str})</button>`;
          actionButtons += `<button class="btn btn-sm btn-outline-danger me-2" onclick="event.stopPropagation(); App.openRejectMilestoneModal(${ag.id}, 0)">❌ Reject Submission</button>`;
        }
        if (statusIdx === 2 && ag.ms2 && ag.ms2.completed && !ag.ms2.approved) {
          actionButtons += `<button class="btn btn-sm btn-success me-2" onclick="event.stopPropagation(); App.approveMilestone(${ag.id}, 1, this)">✅ Approve Delivery (Release ${eth70Str})</button>`;
          actionButtons += `<button class="btn btn-sm btn-outline-danger me-2" onclick="event.stopPropagation(); App.openRejectMilestoneModal(${ag.id}, 1)">❌ Reject Submission</button>`;
        }
      }

      // Conspicuous contextual card footer status
      let footerStatusHtml = "";
      if (actionButtons) {
        footerStatusHtml = actionButtons;
      } else if (statusIdx === 6) { // Cancelled
        footerStatusHtml = `<span class="badge bg-danger bg-opacity-25 border border-danger text-danger px-3 py-1 fw-bold">🛑 Agreement Cancelled • Escrow Fully Refunded (${eth100Str})</span>`;
      } else if (statusIdx === 3) { // Completed
        if (ag.hasRefund || isPastDeadline || ag.isLate || ag.isLateCompleted) {
          footerStatusHtml = `<span class="badge bg-success bg-opacity-25 border border-success text-success px-3 py-1 fw-bold">✅ Completed & Refunded (Late Delivery)</span>`;
        } else {
          footerStatusHtml = `<span class="badge bg-success bg-opacity-25 border border-success text-success px-3 py-1 fw-bold">✅ Completed & Fully Settled</span>`;
        }
      } else if (statusIdx === 4) { // Refunded
        if (ag.ms1 && ag.ms1.completed) {
          footerStatusHtml = `<span class="badge bg-warning bg-opacity-25 border border-warning text-warning px-3 py-1 fw-bold">↩️ 70% Escrow Refunded (${eth70Str}) • Awaiting Late Delivery</span>`;
        } else {
          footerStatusHtml = `<span class="badge bg-danger bg-opacity-25 border border-danger text-danger px-3 py-1 fw-bold">🛑 Cancelled & Refunded (Carrier Missed Pickup)</span>`;
        }
      } else if (statusIdx === 7) { // Rejected
        footerStatusHtml = `<span class="badge bg-danger bg-opacity-25 border border-danger text-danger px-3 py-1 fw-bold">❌ Carrier Declined Agreement (${eth100Str})</span>`;
      } else if (statusIdx === 0) { // PendingAcceptance
        footerStatusHtml = `<span class="text-warning extra-small">⏳ Awaiting Carrier Acceptance</span>`;
      } else {
        footerStatusHtml = `<span class="text-muted extra-small">🚚 Transit in progress</span>`;
      }

      let ms1TimeInfo = "";
      if (ag.ms1 && ag.ms1.completed && ag.ms1SubTime > 0) {
        const t1 = new Date(ag.ms1SubTime * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
        ms1TimeInfo = `<div class="extra-small text-muted mt-1">Submitted: <b class="text-white">${t1}</b> ${ag.ms1SubmittedOnTime ? '<span class="badge bg-success bg-opacity-25 text-success py-0 px-1">On-Time</span>' : '<span class="badge bg-danger bg-opacity-25 text-danger py-0 px-1">Overdue</span>'}</div>`;
      }
      let ms2TimeInfo = "";
      if (ag.ms2 && ag.ms2.completed && ag.ms2SubTime > 0) {
        const t2 = new Date(ag.ms2SubTime * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
        ms2TimeInfo = `<div class="extra-small text-muted mt-1">Submitted: <b class="text-white">${t2}</b> ${ag.ms2SubmittedOnTime ? '<span class="badge bg-success bg-opacity-25 text-success py-0 px-1">On-Time</span>' : '<span class="badge bg-danger bg-opacity-25 text-danger py-0 px-1">Overdue</span>'}</div>`;
      }

      const photoBtn = (ag.initialPhotoIpfs && ag.initialPhotoIpfs !== "QmDefaultCargoProof") ? 
        `<button class="btn btn-sm btn-outline-info py-0 px-2 extra-small ms-2" onclick="event.stopPropagation(); App.showIpfsModal('${ag.initialPhotoIpfs}', '${(ag.cargoTitle || '').replace(/'/g, "\\'")}')">📷 View Cargo Proof (IPFS)</button>` : "";

      html += `
        <div class="shipment-card" onclick="App.openShipmentDetailModal(${ag.id})" title="Click to expand full centralized overview and side-by-side photo proofs">
          <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
            <div>
              <span class="fw-bold text-white fs-5">${ag.cargoTitle || `Freight Contract #${ag.id}`}</span>
              ${photoBtn}
            </div>
            <span class="badge ${statusDisplay.badgeClass} px-3 py-1">${statusDisplay.text}</span>
          </div>
          <div class="row g-2 text-muted small mb-3">
            <div class="col-md-6">Route: <b>${originParsed.address}</b> ➔ <b>${destParsed.address}</b></div>
            <div class="col-md-6 text-md-end">Declared Value: <b class="text-white">RM ${parseFloat(ag.declaredValue || 25000).toLocaleString()}</b></div>
            <div class="col-md-6">Carrier Fleet: <code>${ag.carrier.substring(0, 6)}...${ag.carrier.substring(38)}</code></div>
            <div class="col-md-6 text-md-end">Escrow Deposit: <b class="text-white fs-6">${totalEth} ETH</b> <span class="text-info">(RM ${parseFloat(myrVal).toLocaleString()})</span></div>
            <div class="col-md-6">Milestone 1 (Pickup 30%): ${ag.ms1.approved ? '<span class="text-success fw-bold">✓ Released</span>' : (ag.ms1.completed ? '<span class="text-warning fw-bold">Verification Submitted</span>' : '<span class="text-muted">Pending</span>')}${ms1TimeInfo}</div>
            <div class="col-md-6 text-md-end">Milestone 2 (Delivery 70%): ${ag.ms2.approved ? '<span class="text-success fw-bold">✓ Released</span>' : (ag.ms2.completed ? '<span class="text-warning fw-bold">Sign-off Submitted</span>' : '<span class="text-muted">Pending</span>')}${ms2TimeInfo}</div>
            <div class="col-12 text-muted d-flex align-items-center gap-2 flex-wrap">Delivery Deadline: ${this.formatDeadlineBadge(ag.deadline, statusIdx)}</div>
          </div>
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 pt-2 border-top border-secondary border-opacity-25 mt-2">
            <span class="extra-small text-info opacity-75">🔍 Click card to expand details & proofs ➔</span>
            <div>${footerStatusHtml}</div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  updateCarrierFilterBadges: function () {
    if (!this.allAgreements || !this.account) return;
    const myTasks = this.allAgreements.filter(ag => ag.carrier && ag.carrier.toLowerCase() === this.account.toLowerCase());

    const pickupCount = myTasks.filter(ag => parseInt(ag.status) === 1 && (!ag.ms1 || !ag.ms1.approved)).length;
    const transitCount = myTasks.filter(ag => parseInt(ag.status) === 2 || (parseInt(ag.status) === 4 && ag.ms1 && ag.ms1.completed)).length;
    const completedCount = myTasks.filter(ag => parseInt(ag.status) === 3).length;
    const rejectedCount = myTasks.filter(ag => (ag.ms1Rejection && ag.ms1Rejection.rejected) || (ag.ms2Rejection && ag.ms2Rejection.rejected)).length;

    const pickupBadge = document.getElementById("carrierBadgePickup");
    const transitBadge = document.getElementById("carrierBadgeTransit");
    const completedBadge = document.getElementById("carrierBadgeCompleted");
    const rejectedBadge = document.getElementById("carrierBadgeRejected");

    if (pickupBadge) {
      pickupBadge.innerText = pickupCount;
      if (pickupCount > 0) pickupBadge.classList.remove("d-none");
      else pickupBadge.classList.add("d-none");
    }
    if (transitBadge) {
      transitBadge.innerText = transitCount;
      if (transitCount > 0) transitBadge.classList.remove("d-none");
      else transitBadge.classList.add("d-none");
    }
    if (completedBadge) {
      completedBadge.innerText = completedCount;
      if (completedCount > 0) completedBadge.classList.remove("d-none");
      else completedBadge.classList.add("d-none");
    }
    if (rejectedBadge) {
      rejectedBadge.innerText = rejectedCount;
      if (rejectedCount > 0) rejectedBadge.classList.remove("d-none");
      else rejectedBadge.classList.add("d-none");
    }
  },

  renderCarrierProfileView: async function () {
    if (!this.account) return;

    const myTasks = (this.allAgreements || []).filter(ag => ag.carrier && ag.carrier.toLowerCase() === this.account.toLowerCase());
    const completed = myTasks.filter(ag => parseInt(ag.status) === 3).length;
    const active = myTasks.filter(ag => parseInt(ag.status) === 1 || parseInt(ag.status) === 2 || (parseInt(ag.status) === 4 && ag.ms1 && ag.ms1.completed)).length;
    const cancelled = myTasks.filter(ag => parseInt(ag.status) === 6 || (parseInt(ag.status) === 4 && (!ag.ms1 || !ag.ms1.completed))).length;

    document.getElementById("statCarrierCompleted").innerText = completed;
    document.getElementById("statCarrierActive").innerText = active;
    const statCancelledEl = document.getElementById("statCarrierCancelled");
    if (statCancelledEl) statCancelledEl.innerText = cancelled;

    let totalEarnedWei = BigInt(0);
    myTasks.forEach(ag => {
      const val = BigInt(ag.totalValue || 0);
      if (ag.ms1 && ag.ms1.approved) {
        totalEarnedWei += (val * BigInt(30)) / BigInt(100);
      }
      if (ag.ms2 && ag.ms2.approved) {
        totalEarnedWei += (val * BigInt(70)) / BigInt(100);
      }
    });

    const earningsEth = parseFloat(this.web3.utils.fromWei(totalEarnedWei.toString(), "ether")).toFixed(4);
    document.getElementById("statCarrierEarnings").innerText = `${earningsEth} ETH`;
    document.getElementById("statCarrierEarningsMyr").innerText = `≈ RM ${(parseFloat(earningsEth) * this.ethToMyrRate).toFixed(2)} MYR`;
  },

  renderCarrierTasksView: function () {
    const pendingContainer = document.getElementById("carrierPendingAcceptList");
    const activeContainer = document.getElementById("carrierShipmentsList");
    if (!activeContainer || !this.account) return;

    this.updateCarrierFilterBadges();

    const myTasks = (this.allAgreements || []).filter(ag => ag.carrier && ag.carrier.toLowerCase() === this.account.toLowerCase());
    const nowSec = this.getNowSec();

    // 1. Incoming Requests (Status 0: PendingAcceptance) - Hide expired pending offers from carrier
    const pendingRequests = myTasks.filter(ag => parseInt(ag.status) === 0 && nowSec <= parseInt(ag.deadline));
    const pendingBadge = document.getElementById("pendingAcceptCountBadge");
    if (pendingBadge) {
      pendingBadge.innerText = `${pendingRequests.length} Action Needed`;
    }

    if (pendingRequests.length === 0) {
      pendingContainer.innerHTML = `
        <div class="text-center py-4 text-muted small bg-black bg-opacity-25 rounded border border-secondary border-opacity-30">
          <span class="fs-4 d-block mb-1">📬</span>
          No pending shipment offers right now. Shippers will assign new contracts directly to your fleet!
        </div>
      `;
    } else {
      let pendingHtml = "";
      pendingRequests.forEach(req => {
        const payoutEth = parseFloat(this.web3.utils.fromWei(req.totalValue, "ether")).toFixed(4);
        const myrPayout = (parseFloat(payoutEth) * this.ethToMyrRate).toFixed(2);
        const deadlineDate = new Date(parseInt(req.deadline) * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

        const photoBtn = (req.initialPhotoIpfs && req.initialPhotoIpfs !== "QmDefaultCargoProof") ? 
          `<button class="btn btn-sm btn-outline-info py-0 px-2 extra-small ms-2" onclick="event.stopPropagation(); App.showIpfsModal('${req.initialPhotoIpfs}', '${(req.cargoTitle || '').replace(/'/g, "\\'")}')">📷 View Cargo Proof</button>` : "";

        const originParsed = this.parseAddressAndDetails(req.origin);
        const destParsed = this.parseAddressAndDetails(req.dest);

        pendingHtml += `
          <div class="shipment-card border-warning mb-3" onclick="App.openShipmentDetailModal(${req.id})" title="Click card to expand full contract overview & specs">
            <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
              <div>
                <span class="fw-bold text-white fs-6">${req.cargoTitle || `Freight Contract #${req.id}`}</span>
                ${photoBtn}
              </div>
              <span class="badge bg-warning text-dark px-3 py-1">Pending Acceptance</span>
            </div>
            <div class="row g-2 text-muted small mb-3">
              <div class="col-md-6">Route: <b>${originParsed.address}</b> ➔ <b>${destParsed.address}</b></div>
              <div class="col-md-6 text-md-end">Declared Value: <b class="text-white">RM ${parseFloat(req.declaredValue || 25000).toLocaleString()}</b></div>
              <div class="col-md-6">Total Escrow Freight Payout: <b class="text-success fs-6">${payoutEth} ETH</b> <span class="text-info">(RM ${parseFloat(myrPayout).toLocaleString()})</span></div>
              <div class="col-md-6 text-md-end d-flex align-items-center justify-content-md-end gap-2 flex-wrap">Delivery Deadline: ${this.formatDeadlineBadge(req.deadline, 0)}</div>
            </div>
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 pt-2 border-top border-secondary border-opacity-25 mt-2">
              <span class="extra-small text-info opacity-75">🔍 Click card to expand details & proof ➔</span>
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-danger px-3" onclick="event.stopPropagation(); App.rejectCarrierShipment(${req.id}, this)">❌ Reject (100% Shipper Refund)</button>
                <button class="btn btn-sm btn-success px-4 fw-bold" onclick="event.stopPropagation(); App.acceptCarrierShipment(${req.id}, this)">✅ Accept Freight Contract</button>
              </div>
            </div>
          </div>
        `;
      });
      pendingContainer.innerHTML = pendingHtml;
    }

    // 2. Active & Historical Task Queue (only tasks carrier accepted, excluding PendingAcceptance and Rejected)
    const statusNames = ["PendingAcceptance", "PickupRequired", "InTransit", "Completed", "Refunded", "Disputed", "Cancelled", "Rejected"];
    let activeTasks = myTasks.filter(ag => 
      (ag.wasAccepted || (parseInt(ag.status) === 4 && ag.ms1 && ag.ms1.completed)) && 
      parseInt(ag.status) !== 0 && 
      parseInt(ag.status) !== 7
    );

    if (this.carrierFilter !== "ALL") {
      activeTasks = activeTasks.filter(ag => {
        const sIdx = parseInt(ag.status);
        if (this.carrierFilter === "PickupRequired") return sIdx === 1 && (!ag.ms1 || !ag.ms1.approved);
        if (this.carrierFilter === "InTransit") return sIdx === 2 || (sIdx === 4 && ag.ms1 && ag.ms1.completed);
        if (this.carrierFilter === "Completed") return sIdx === 3;
        if (this.carrierFilter === "RejectedProof") return (ag.ms1Rejection && ag.ms1Rejection.rejected) || (ag.ms2Rejection && ag.ms2Rejection.rejected);
        return (statusNames[sIdx] || "PickupRequired") === this.carrierFilter;
      });
    }

    if (this.carrierSort === "valueHigh") {
      activeTasks.sort((a, b) => BigInt(b.totalValue) > BigInt(a.totalValue) ? 1 : -1);
    } else if (this.carrierSort === "deadlineLate") {
      activeTasks.sort((a, b) => parseInt(b.deadline) - parseInt(a.deadline));
    } else if (this.carrierSort === "newest") {
      activeTasks.sort((a, b) => b.id - a.id);
    } else if (this.carrierSort === "oldest") {
      activeTasks.sort((a, b) => a.id - b.id);
    } else { // "urgency" / "deadlineSoon"
      activeTasks.sort((a, b) => parseInt(a.deadline) - parseInt(b.deadline));
    }

    if (activeTasks.length === 0) {
      activeContainer.innerHTML = `
        <div class="text-center py-5 glass-card">
          <div class="display-6 mb-2">🚚</div>
          <h5 class="text-white fw-bold mb-1">No Active Freight Tasks Found</h5>
          <p class="text-muted small mb-0">You don't have any assigned tasks matching this status filter.</p>
        </div>
      `;
      return;
    }

    let activeHtml = "";
    activeTasks.forEach(ag => {
      const statusIdx = parseInt(ag.status);
      const statusDisplay = this.getStatusDisplay(ag);
      const totalEth = parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4);
      const myrVal = (parseFloat(totalEth) * this.ethToMyrRate).toFixed(2);
      const deadlineDate = new Date(parseInt(ag.deadline) * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

      const isPastDeadline = nowSec > parseInt(ag.deadline);
      const eth30Str = this.formatPercentAmount(ag.totalValue, 30);
      const eth70Str = this.formatPercentAmount(ag.totalValue, 70);

      let actionButtons = "";
      if (statusIdx === 1 && (!ag.ms1 || !ag.ms1.completed)) {
        if (isPastDeadline) {
          // Late pickup allowed, but 0 ETH payout
          actionButtons += `<button class="btn btn-sm btn-warning text-dark px-3 fw-bold me-2 border-warning shadow-sm" onclick="event.stopPropagation(); App.openCarrierProofModal(${ag.id}, 0)">⚠️ Submit Late Pickup Proof (0 ETH • Overdue)</button>`;
        } else {
          actionButtons += `<button class="btn btn-sm btn-primary px-3 fw-bold me-2" onclick="event.stopPropagation(); App.openCarrierProofModal(${ag.id}, 0)">🚚 Submit Pickup Proof (${eth30Str})</button>`;
        }
      } else if (statusIdx === 1 && ag.ms1 && ag.ms1.completed && !ag.ms1.approved) {
        actionButtons += `<span class="badge bg-warning bg-opacity-25 border border-warning text-warning px-3 py-1 fw-bold">⏳ Awaiting Shipper Approval (${eth30Str})</span>`;
      }

      if ((statusIdx === 2 || (statusIdx === 4 && ag.ms1 && ag.ms1.completed)) && (!ag.ms2 || !ag.ms2.completed)) {
        if (isPastDeadline || statusIdx === 4) {
          actionButtons += `<button class="btn btn-sm btn-warning text-dark px-3 fw-bold me-2 border-warning shadow-sm" onclick="event.stopPropagation(); App.openCarrierProofModal(${ag.id}, 1)">⚠️ Submit Late Delivery Proof (0 ETH • Overdue)</button>`;
        } else {
          actionButtons += `<button class="btn btn-sm btn-success px-3 fw-bold me-2" onclick="event.stopPropagation(); App.openCarrierProofModal(${ag.id}, 1)">🏁 Submit Delivery Sign-off Proof (${eth70Str})</button>`;
        }
      } else if ((statusIdx === 2 || statusIdx === 4) && ag.ms2 && ag.ms2.completed && !ag.ms2.approved) {
        if (ag.ms2SubmittedOnTime) {
          actionButtons += `<span class="badge bg-success bg-opacity-25 border border-success text-success px-3 py-1 fw-bold">⏳ Submitted On Time • Awaiting Shipper Approval (${eth70Str})</span>`;
        } else if (isPastDeadline || statusIdx === 4) {
          actionButtons += `<span class="badge bg-warning bg-opacity-25 border border-warning text-warning px-3 py-1 fw-bold">⏳ Awaiting Shipper Validation (Late Delivery Done)</span>`;
        } else {
          actionButtons += `<span class="badge bg-warning bg-opacity-25 border border-warning text-warning px-3 py-1 fw-bold">⏳ Awaiting Shipper Final Settlement (${eth70Str})</span>`;
        }
      }

      if (statusIdx === 3) {
        if (isPastDeadline || BigInt(ag.remainingBalance || 0) === BigInt(0)) {
          actionButtons += `<span class="badge bg-success bg-opacity-25 border border-success text-success px-3 py-1 fw-bold">✅ Completed (Late Delivery • Escrow Refunded)</span>`;
        } else {
          actionButtons += `<span class="badge bg-success bg-opacity-25 border border-success text-success px-3 py-1 fw-bold">✅ Completed & Fully Paid</span>`;
        }
      } else if (statusIdx === 4) {
        if (!actionButtons) {
          actionButtons += `<span class="badge bg-secondary bg-opacity-25 border border-secondary text-light px-3 py-1 fw-bold">↩️ Escrow Refunded</span>`;
        }
      } else if (statusIdx === 6) {
        actionButtons += `<span class="badge bg-danger bg-opacity-25 border border-danger text-danger px-3 py-1 fw-bold">🛑 Cancelled by Shipper</span>`;
      }

      let ms1TimeInfo = "";
      if (ag.ms1 && ag.ms1.completed && ag.ms1SubTime > 0) {
        const t1 = new Date(ag.ms1SubTime * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
        ms1TimeInfo = `<div class="extra-small text-muted mt-1">Submitted: <b class="text-white">${t1}</b> ${ag.ms1SubmittedOnTime ? '<span class="badge bg-success bg-opacity-25 text-success py-0 px-1">On-Time</span>' : '<span class="badge bg-danger bg-opacity-25 text-danger py-0 px-1">Overdue</span>'}</div>`;
      }
      let ms2TimeInfo = "";
      if (ag.ms2 && ag.ms2.completed && ag.ms2SubTime > 0) {
        const t2 = new Date(ag.ms2SubTime * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
        ms2TimeInfo = `<div class="extra-small text-muted mt-1">Submitted: <b class="text-white">${t2}</b> ${ag.ms2SubmittedOnTime ? '<span class="badge bg-success bg-opacity-25 text-success py-0 px-1">On-Time</span>' : '<span class="badge bg-danger bg-opacity-25 text-danger py-0 px-1">Overdue</span>'}</div>`;
      }

      const photoBtn = (ag.initialPhotoIpfs && ag.initialPhotoIpfs !== "QmDefaultCargoProof") ? 
        `<button class="btn btn-sm btn-outline-info py-0 px-2 extra-small ms-2" onclick="event.stopPropagation(); App.showIpfsModal('${ag.initialPhotoIpfs}', '${(ag.cargoTitle || '').replace(/'/g, "\\'")}')">📷 View Cargo Proof</button>` : "";

      const originParsed = this.parseAddressAndDetails(ag.origin);
      const destParsed = this.parseAddressAndDetails(ag.dest);

      let rejectionNotice = "";
      if (ag.ms1Rejection && ag.ms1Rejection.rejected) {
        rejectionNotice += `
          <div class="alert alert-danger p-2 mb-2 rounded border border-danger border-opacity-75">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-1">
              <div>
                <span class="badge bg-danger text-white me-1">REJECTED</span>
                <span class="fw-bold text-danger small">Milestone 1 (Pickup) Proof Rejected by Shipper</span>
              </div>
              ${ag.ms1Rejection.lastProof ? `<button class="btn btn-sm btn-outline-danger py-0 px-2 extra-small ms-auto" onclick="event.stopPropagation(); App.showIpfsModal('${ag.ms1Rejection.lastProof}', 'Rejected Pickup Proof')">📷 View Rejected Photo</button>` : ''}
            </div>
            <div class="small text-white mt-1"><b>Shipper Rejection Note:</b> "${ag.ms1Rejection.reason}"</div>
          </div>
        `;
      }
      if (ag.ms2Rejection && ag.ms2Rejection.rejected) {
        rejectionNotice += `
          <div class="alert alert-danger p-2 mb-2 rounded border border-danger border-opacity-75">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-1">
              <div>
                <span class="badge bg-danger text-white me-1">REJECTED</span>
                <span class="fw-bold text-danger small">Milestone 2 (Delivery) Proof Rejected by Shipper</span>
              </div>
              ${ag.ms2Rejection.lastProof ? `<button class="btn btn-sm btn-outline-danger py-0 px-2 extra-small ms-auto" onclick="event.stopPropagation(); App.showIpfsModal('${ag.ms2Rejection.lastProof}', 'Rejected Delivery Proof')">📷 View Rejected Photo</button>` : ''}
            </div>
            <div class="small text-white mt-1"><b>Shipper Rejection Note:</b> "${ag.ms2Rejection.reason}"</div>
          </div>
        `;
      }

      const ms1StatusDisplay = (ag.ms1Rejection && ag.ms1Rejection.rejected) ?
        '<span class="badge bg-danger text-white px-2 py-0">Rejected - Resubmission Needed</span>' :
        (ag.ms1.approved ? '<span class="text-success fw-bold">✓ Paid</span>' : (ag.ms1.completed ? '<span class="text-warning">Pending Shipper Confirmation</span>' : '<span class="text-info fw-bold">Action Needed: Pickup Cargo</span>'));

      const ms2StatusDisplay = (ag.ms2Rejection && ag.ms2Rejection.rejected) ?
        '<span class="badge bg-danger text-white px-2 py-0">Rejected - Resubmission Needed</span>' :
        (ag.ms2.approved ? '<span class="text-success fw-bold">✓ Paid</span>' : (ag.ms2.completed ? '<span class="text-warning">Pending Shipper Verification</span>' : (statusIdx === 4 ? '<span class="text-warning fw-bold">Late Delivery Required (+100 CRT)</span>' : 'Pending Final Delivery')));

      activeHtml += `
        <div class="shipment-card" onclick="App.openShipmentDetailModal(${ag.id})" title="Click to expand centralized task details & photo proofs">
          <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
            <div>
              <span class="fw-bold text-white fs-5">${ag.cargoTitle || `Freight Contract #${ag.id}`}</span>
              ${photoBtn}
            </div>
            <span class="badge ${statusDisplay.badgeClass} px-3 py-1">${statusDisplay.text}</span>
          </div>
          ${rejectionNotice}
          <div class="row g-2 text-muted small mb-3">
            <div class="col-md-6">Route: <b>${originParsed.address}</b> ➔ <b>${destParsed.address}</b></div>
            <div class="col-md-6 text-md-end">Earnable Freight Payout: ${statusIdx === 4 ? '<b class="text-warning fs-6">0.0000 ETH</b> <span class="badge bg-warning bg-opacity-25 text-warning extra-small">Overdue Escrow Refunded</span>' : `<b class="text-success fs-6">${totalEth} ETH</b> <span class="text-info">(RM ${parseFloat(myrVal).toLocaleString()})</span>`}</div>
            <div class="col-md-6">Milestone 1 (${eth30Str}): ${ms1StatusDisplay}${ms1TimeInfo}</div>
            <div class="col-md-6 text-md-end">Milestone 2 (${eth70Str}): ${ms2StatusDisplay}${ms2TimeInfo}</div>
            <div class="col-12 text-muted d-flex align-items-center gap-2 flex-wrap">Delivery Deadline: ${this.formatDeadlineBadge(ag.deadline, statusIdx)}</div>
          </div>
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 pt-2 border-top border-secondary border-opacity-25 mt-2">
            <span class="extra-small text-info opacity-75">🔍 Click card to expand details & proofs ➔</span>
            <div>${actionButtons || '<span class="text-muted extra-small">Waiting on Shipper review</span>'}</div>
          </div>
        </div>
      `;
    });

    activeContainer.innerHTML = activeHtml;
  },

  renderLedgerTable: function (agreementsList) {
    const tbody = document.getElementById("agreementTableBody");
    tbody.innerHTML = "";

    let list = [...agreementsList];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted">No blockchain escrow records found on-chain. Dispatched agreements will appear here permanently indexed.</td></tr>`;
      return;
    }

    list.forEach(ag => {
      const statusIdx = parseInt(ag.status);
      const statusDisplay = this.getStatusDisplay(ag);
      const totalEth = parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4);
      const myrVal = (totalEth * this.ethToMyrRate).toFixed(2);
      const deadlineDate = new Date(parseInt(ag.deadline) * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

      let timelineHtml = `<div class="extra-small">`;
      if (ag.ms1 && ag.ms1.completed && ag.ms1SubTime > 0) {
        const t1 = new Date(ag.ms1SubTime * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
        timelineHtml += `<div>📦 Pickup: <b class="text-white">${t1}</b> ${ag.ms1SubmittedOnTime ? '<span class="badge bg-success bg-opacity-25 text-success py-0 px-1">On-Time</span>' : '<span class="badge bg-danger bg-opacity-25 text-danger py-0 px-1">Overdue</span>'}</div>`;
      } else {
        timelineHtml += `<div class="text-muted">📦 Pickup: <i>Pending</i></div>`;
      }

      if (ag.ms2 && ag.ms2.completed && ag.ms2SubTime > 0) {
        const t2 = new Date(ag.ms2SubTime * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
        timelineHtml += `<div class="mt-1">🏁 Delivery: <b class="text-white">${t2}</b> ${ag.ms2SubmittedOnTime ? '<span class="badge bg-success bg-opacity-25 text-success py-0 px-1">On-Time</span>' : '<span class="badge bg-danger bg-opacity-25 text-danger py-0 px-1">Overdue</span>'}</div>`;
      } else {
        timelineHtml += `<div class="text-muted mt-1">🏁 Delivery: <i>Pending</i></div>`;
      }
      timelineHtml += `</div>`;

      tbody.innerHTML += `
        <tr>
          <td class="fw-bold text-white">#${ag.id}</td>
          <td><code>${ag.shipper.substring(0, 6)}...${ag.shipper.substring(38)}</code></td>
          <td><code>${ag.carrier.substring(0, 6)}...${ag.carrier.substring(38)}</code></td>
          <td>${totalEth} ETH <span class="extra-small text-muted">(RM ${parseFloat(myrVal).toLocaleString()})</span></td>
          <td>
            <span class="badge ${ag.ms1 && ag.ms1.approved ? 'bg-success' : 'bg-secondary'} me-1">Pickup 30%</span>
            <span class="badge ${ag.ms2 && ag.ms2.approved ? 'bg-success' : 'bg-secondary'}">Delivery 70%</span>
          </td>
          <td>${timelineHtml}</td>
          <td>${deadlineDate} ${this.formatDeadlineBadge(ag.deadline, statusIdx)}</td>
          <td><span class="badge ${statusDisplay.badgeClass}">${statusDisplay.text}</span></td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary extra-small px-3 py-1 fw-semibold" onclick="App.openShipmentDetailModal(${ag.id})">🔍 View Details</button>
          </td>
        </tr>
      `;
    });
  },

  filterLedger: function () {
    const filter = document.getElementById("ledgerStatusFilter").value;

    if (filter === "ALL") {
      this.renderLedgerTable(this.allAgreements);
    } else {
      const filtered = this.allAgreements.filter(ag => {
        const sDisplay = this.getStatusDisplay(ag);
        if (filter === "PendingAcceptance") {
          return sDisplay.name === "PendingAcceptance" || sDisplay.name === "Expired" || parseInt(ag.status) === 0;
        }
        if (filter === "PickupRequired") {
          return sDisplay.name === "PickupRequired" || parseInt(ag.status) === 1;
        }
        if (filter === "InTransit") {
          return sDisplay.name === "InTransit" || parseInt(ag.status) === 2;
        }
        if (filter === "Completed") {
          return sDisplay.name === "Completed" || parseInt(ag.status) === 3;
        }
        if (filter === "Refunded") {
          return sDisplay.name === "Refunded" || parseInt(ag.status) === 4 || ag.hasRefund;
        }
        if (filter === "Cancelled") {
          return sDisplay.name === "Cancelled" || parseInt(ag.status) === 6;
        }
        if (filter === "Declined") {
          return sDisplay.name === "Declined" || parseInt(ag.status) === 7;
        }
        return sDisplay.name === filter;
      });
      this.renderLedgerTable(filtered);
    }
  },

  showIpfsModal: function (cid, title) {
    const modalEl = document.getElementById("ipfsPhotoModal");
    if (!modalEl) return;

    document.getElementById("ipfsModalTitle").innerText = title ? `📷 ${title} - IPFS Proof` : "📷 IPFS Cargo Inspection Photo";
    document.getElementById("ipfsModalCid").innerText = cid;

    const imgEl = document.getElementById("ipfsModalImage");
    imgEl.onerror = function () {
      this.onerror = null;
      this.src = `https://gateway.pinata.cloud/ipfs/${cid}`;
    };
    imgEl.src = `/ipfs/${cid}`;

    const extLink = document.getElementById("ipfsModalExternalLink");
    extLink.href = `https://gateway.pinata.cloud/ipfs/${cid}`;

    try {
      if (typeof bootstrap !== "undefined" && bootstrap.Modal) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
      } else {
        modalEl.classList.add("show");
        modalEl.style.display = "block";
      }
    } catch (e) {
      console.error("Error opening IPFS modal:", e);
    }
  },

  hideShipmentDetailModal: function () {
    this.activeDetailAgreementId = null;
    const modalEl = document.getElementById("shipmentDetailModal");
    if (modalEl) {
      if (typeof bootstrap !== "undefined" && bootstrap.Modal) {
        const modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
        if (modal) modal.hide();
      }
      modalEl.classList.remove("show");
      modalEl.style.display = "none";
      modalEl.setAttribute("aria-hidden", "true");
    }
    document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());
    document.body.classList.remove("modal-open");
    document.body.style.removeProperty("overflow");
    document.body.style.removeProperty("padding-right");
  },

  openShipmentDetailModal: function (id) {
    const ag = this.allAgreements.find(a => String(a.id) === String(id));
    if (!ag) {
      alert("Shipment contract #" + id + " not found.");
      return;
    }

    this.activeDetailAgreementId = id;
    const modalEl = document.getElementById("shipmentDetailModal");
    if (!modalEl) return;

    const statusIdx = parseInt(ag.status);
    const statusDisplay = this.getStatusDisplay(ag);

    const eth30Str = this.formatPercentAmount(ag.totalValue, 30);
    const eth70Str = this.formatPercentAmount(ag.totalValue, 70);
    const eth100Str = this.formatPercentAmount(ag.totalValue, 100);

    // 1. Header Information
    const titleEl = document.getElementById("modalShipmentTitle");
    if (titleEl) titleEl.innerText = ag.cargoTitle || `Freight Contract #${ag.id}`;

    const idBadgeEl = document.getElementById("modalShipmentIdBadge");
    if (idBadgeEl) idBadgeEl.innerText = `Escrow Contract #${ag.id}`;

    const statusBadgeEl = document.getElementById("modalShipmentStatusBadge");
    if (statusBadgeEl) {
      statusBadgeEl.className = `badge ${statusDisplay.badgeClass} px-3 py-1`;
      statusBadgeEl.innerText = statusDisplay.text;
    }

    const iconEl = document.getElementById("modalShipmentIcon");
    if (iconEl) {
      if (statusIdx === 3) iconEl.innerText = "✅";
      else if (statusIdx === 5) iconEl.innerText = "⚠️";
      else if (statusIdx === 6 || statusIdx === 7) iconEl.innerText = "🛑";
      else if (statusIdx === 2 || (statusIdx === 4 && ag.ms1 && ag.ms1.completed)) iconEl.innerText = "🚚";
      else iconEl.innerText = "📦";
    }

    // 2. Proof Gallery (Side-by-Side Comparison)
    const proofs = [];

    // Stage 1: Origin initial cargo proof
    if (ag.initialPhotoIpfs && ag.initialPhotoIpfs !== "" && ag.initialPhotoIpfs !== "N/A") {
      proofs.push({
        stage: 1,
        title: "Stage 1: Origin Cargo Manifest",
        stageBadge: "Stage 1 • Shipper Creation",
        statusText: "Baseline Condition",
        statusBadgeClass: "bg-primary bg-opacity-25 border border-primary text-primary",
        cid: ag.initialPhotoIpfs,
        description: "Initial physical condition & packing manifest recorded by shipper before dispatch.",
        icon: "📦"
      });
    }

    // Stage 2: Carrier pickup verification proof (Milestone 1)
    if (ag.ms1 && ag.ms1.completed && ag.ms1.ipfsProofHash && ag.ms1.ipfsProofHash !== "" && ag.ms1.ipfsProofHash !== "N/A" && ag.ms1.ipfsProofHash !== "null") {
      proofs.push({
        stage: 2,
        title: "Stage 2: Carrier Pickup Verification",
        stageBadge: `Stage 2 • Milestone 1 (${eth30Str})`,
        statusText: ag.ms1.approved ? "Approved & Disbursed" : "Submitted for Review",
        statusBadgeClass: ag.ms1.approved ? "bg-success bg-opacity-25 border border-success text-success" : "bg-warning bg-opacity-25 border border-warning text-warning",
        cid: ag.ms1.ipfsProofHash,
        description: "Inspection photo taken at origin loading dock by carrier driver prior to departure.",
        icon: "🚚"
      });
    }

    // Stage 3: Final recipient delivery signoff proof (Milestone 2)
    if (ag.ms2 && ag.ms2.completed && ag.ms2.ipfsProofHash && ag.ms2.ipfsProofHash !== "" && ag.ms2.ipfsProofHash !== "N/A" && ag.ms2.ipfsProofHash !== "null") {
      proofs.push({
        stage: 3,
        title: "Stage 3: Recipient Delivery Sign-off",
        stageBadge: `Stage 3 • Milestone 2 (${eth70Str})`,
        statusText: ag.ms2.approved ? "Final Settlement" : "Submitted for Sign-off",
        statusBadgeClass: ag.ms2.approved ? "bg-success bg-opacity-25 border border-success text-success" : "bg-warning bg-opacity-25 border border-warning text-warning",
        cid: ag.ms2.ipfsProofHash,
        description: "Destination unloading photo & recipient delivery receipt confirmation.",
        icon: "🏁"
      });
    }

    const proofGalleryEl = document.getElementById("modalProofGallery");
    const proofCountInfoEl = document.getElementById("modalProofCountInfo");

    if (proofGalleryEl) {
      if (proofs.length === 0) {
        if (proofCountInfoEl) proofCountInfoEl.innerText = "No photographic proofs recorded on-chain yet";
        proofGalleryEl.innerHTML = `
          <div class="col-12">
            <div class="p-4 text-center rounded bg-black bg-opacity-30 border border-secondary border-opacity-30">
              <span class="fs-1 d-block mb-2">📷</span>
              <div class="text-white small fw-bold">No Inspection Photos Uploaded</div>
              <div class="text-muted extra-small">No IPFS multihash proofs have been recorded for this agreement.</div>
            </div>
          </div>
        `;
      } else {
        let colClass = "col-12 col-md-4";
        if (proofs.length === 1) {
          colClass = "col-12 col-md-8 col-lg-6 mx-auto";
          if (proofCountInfoEl) proofCountInfoEl.innerText = "1 Image Proof (Origin Cargo Baseline)";
        } else if (proofs.length === 2) {
          colClass = "col-12 col-md-6";
          if (proofCountInfoEl) proofCountInfoEl.innerText = "2 Image Proofs (Side-by-Side: Origin vs. Pickup Inspection)";
        } else {
          colClass = "col-12 col-md-4";
          if (proofCountInfoEl) proofCountInfoEl.innerText = "3 Image Proofs (Full Lifecycle: Origin ➔ Pickup ➔ Delivery)";
        }

        let galleryHtml = "";
        proofs.forEach(p => {
          const safeTitle = (p.title || "").replace(/'/g, "\\'");
          galleryHtml += `
            <div class="${colClass}">
              <div class="proof-card h-100">
                <div class="d-flex justify-content-between align-items-start mb-2 gap-2">
                  <div>
                    <span class="proof-stage-badge mb-1 d-inline-block">${p.stageBadge}</span>
                    <div class="fw-bold text-white small d-flex align-items-center gap-1">
                      <span>${p.icon}</span> ${p.title}
                    </div>
                  </div>
                  <span class="badge ${p.statusBadgeClass} extra-small">${p.statusText}</span>
                </div>

                <div class="proof-img-box mb-2" onclick="App.showIpfsModal('${p.cid}', '${safeTitle}')" title="Click to zoom proof" style="cursor: zoom-in;">
                  <img src="/ipfs/${p.cid}" 
                       onerror="this.onerror=null; this.src='https://gateway.pinata.cloud/ipfs/${p.cid}'; this.onerror=function(){this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100%25\\' height=\\'100%25\\' viewBox=\\'0 0 300 200\\'><rect fill=\\'%231e293b\\' width=\\'300\\' height=\\'200\\'/><text fill=\\'%2394a3b8\\' font-family=\\'sans-serif\\' font-size=\\'13\\' dy=\\'10.5\\' font-weight=\\'bold\\' x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\'>📷 IPFS Cargo Proof (${p.cid.substring(0,10)}...)</text></svg>';};" 
                       alt="${p.title}" 
                       class="img-fluid w-100 h-100" 
                       style="object-fit: cover; object-position: center; transition: transform 0.3s ease;">
                  <div class="position-absolute bottom-0 end-0 m-2 px-2 py-1 bg-black bg-opacity-75 rounded extra-small text-info border border-secondary border-opacity-30">
                    🔍 Zoom
                  </div>
                </div>

                <div class="extra-small text-muted mb-2 flex-grow-1">${p.description}</div>

                <div class="mt-auto pt-2 border-top border-secondary border-opacity-30 d-flex justify-content-between align-items-center gap-1">
                  <code class="text-info extra-small text-truncate" style="max-width: 140px;" title="${p.cid}">${p.cid}</code>
                  <div class="btn-group btn-group-sm">
                    <button class="btn btn-outline-secondary btn-sm extra-small py-0 px-2" onclick="event.stopPropagation(); navigator.clipboard.writeText('${p.cid}'); alert('IPFS Multihash CID copied!');" title="Copy CID">📋</button>
                    <a href="https://gateway.pinata.cloud/ipfs/${p.cid}" target="_blank" class="btn btn-outline-info btn-sm extra-small py-0 px-2" onclick="event.stopPropagation();" title="View on IPFS Gateway">🌐 Gateway</a>
                  </div>
                </div>
              </div>
            </div>
          `;
        });
        proofGalleryEl.innerHTML = galleryHtml;
      }
    }

    // 3. Middle Section: Physical Transit Route & Manifest
    const originParsed = this.parseAddressAndDetails(ag.origin);
    const originEl = document.getElementById("modalOriginLocation");
    if (originEl) originEl.innerText = originParsed.address || "Origin Depot";

    const originManualEl = document.getElementById("modalOriginManualDetails");
    if (originManualEl) originManualEl.innerText = originParsed.details;

    const destParsed = this.parseAddressAndDetails(ag.dest);
    const destEl = document.getElementById("modalDestLocation");
    if (destEl) destEl.innerText = destParsed.address || "Destination Depot";

    const destManualEl = document.getElementById("modalDestManualDetails");
    if (destManualEl) destManualEl.innerText = destParsed.details;

    const declaredValueEl = document.getElementById("modalDeclaredValue");
    if (declaredValueEl) declaredValueEl.innerText = `RM ${parseFloat(ag.declaredValue || 25000).toLocaleString()}`;
    
    const deadlineEl = document.getElementById("modalDeadline");
    if (deadlineEl) deadlineEl.innerHTML = this.formatDeadlineBadge(ag.deadline, statusIdx);

    // Financials
    const totalEth = parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4);
    const totalMyr = (totalEth * this.ethToMyrRate).toFixed(2);
    const totalEscrowEl = document.getElementById("modalTotalEscrow");
    if (totalEscrowEl) totalEscrowEl.innerText = `${totalEth} ETH (RM ${parseFloat(totalMyr).toLocaleString()})`;

    const remEth = parseFloat(this.web3.utils.fromWei(ag.remainingBalance, "ether")).toFixed(4);
    const remMyr = (remEth * this.ethToMyrRate).toFixed(2);
    const remainingEscrowEl = document.getElementById("modalRemainingEscrow");
    if (remainingEscrowEl) remainingEscrowEl.innerText = `${remEth} ETH (RM ${parseFloat(remMyr).toLocaleString()})`;

    // Participants
    const shipperAddrEl = document.getElementById("modalShipperAddr");
    if (shipperAddrEl) shipperAddrEl.innerText = ag.shipper;

    const carrierAddrEl = document.getElementById("modalCarrierAddr");
    if (carrierAddrEl) carrierAddrEl.innerText = ag.carrier;

    // Milestones with exact ETH and MYR
    const ms1Badge = document.getElementById("modalMs1Badge");
    const ms1Sub = document.getElementById("modalMs1Sub");
    if (ms1Badge && ms1Sub) {
      let subTimeStr = "";
      if (ag.ms1 && ag.ms1.completed && ag.ms1SubTime > 0) {
        const t1 = new Date(ag.ms1SubTime * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
        subTimeStr = ` [Submitted: ${t1} • ${ag.ms1SubmittedOnTime ? 'On-Time' : 'Overdue'}]`;
      }
      if (ag.ms1 && ag.ms1.approved) {
        ms1Badge.className = "badge bg-success";
        ms1Badge.innerText = `✓ Released (${eth30Str})`;
        ms1Sub.innerText = `Pickup approved by Shipper & ${eth30Str} ETH payout disbursed.${subTimeStr}`;
      } else if (ag.ms1 && ag.ms1.completed) {
        ms1Badge.className = "badge bg-warning text-dark";
        ms1Badge.innerText = `Pending Shipper Approval (${eth30Str})`;
        ms1Sub.innerText = `Carrier submitted pickup photo.${subTimeStr} Awaiting Shipper confirmation.`;
      } else {
        ms1Badge.className = "badge bg-secondary";
        ms1Badge.innerText = `Pending Pickup (${eth30Str})`;
        ms1Sub.innerText = "Awaiting Carrier arrival at origin loading dock.";
      }
    }

    const ms2Badge = document.getElementById("modalMs2Badge");
    const ms2Sub = document.getElementById("modalMs2Sub");
    if (ms2Badge && ms2Sub) {
      let subTimeStr2 = "";
      if (ag.ms2 && ag.ms2.completed && ag.ms2SubTime > 0) {
        const t2 = new Date(ag.ms2SubTime * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
        subTimeStr2 = ` [Submitted: ${t2} • ${ag.ms2SubmittedOnTime ? 'On-Time' : 'Overdue'}]`;
      }
      if (ag.ms2 && ag.ms2.approved) {
        ms2Badge.className = "badge bg-success";
        ms2Badge.innerText = `✓ Released (${eth70Str})`;
        ms2Sub.innerText = `Final delivery confirmed by Shipper & ${eth70Str} ETH payout disbursed.${subTimeStr2}`;
      } else if (ag.ms2 && ag.ms2.completed) {
        ms2Badge.className = "badge bg-warning text-dark";
        ms2Badge.innerText = `Pending Shipper Sign-off (${eth70Str})`;
        ms2Sub.innerText = `Carrier submitted delivery sign-off.${subTimeStr2} Awaiting Shipper final settlement.`;
      } else {
        ms2Badge.className = "badge bg-secondary";
        ms2Badge.innerText = `Pending Delivery (${eth70Str})`;
        ms2Sub.innerText = "Cargo en route to destination facility.";
      }
    }

    // 4. Bottom Functional Action Buttons
    let actionsHtml = "";
    const isShipper = this.account && ag.shipper && ag.shipper.toLowerCase() === this.account.toLowerCase();
    const isCarrier = this.account && ag.carrier && ag.carrier.toLowerCase() === this.account.toLowerCase();

    if (isShipper) {
      const nowSec = this.getNowSec();
      const isPastDeadline = ag.deadline && nowSec > parseInt(ag.deadline);
      const isLateOrRefunded = isPastDeadline || statusIdx === 4;
      const remainingEthNum = parseFloat(this.web3.utils.fromWei(ag.remainingBalance || "0", "ether"));
      const hasRemaining = remainingEthNum > 0 && statusIdx !== 3 && statusIdx !== 4 && statusIdx !== 6 && statusIdx !== 7;

      if (statusIdx === 6) {
        // Cancelled shipment: NO dispute, only info
        actionsHtml += `<span class="badge bg-danger bg-opacity-25 border border-danger text-danger px-3 py-2 fw-bold me-2">🛑 Agreement Cancelled & Refunded (${eth100Str})</span>`;
      } else if (isLateOrRefunded) {
        if (statusIdx === 0) {
          actionsHtml += `<button class="btn btn-sm btn-outline-danger px-3 fw-bold" onclick="App.cancelAgreement(${ag.id}, this)">⏰ Cancel Expired Offer & Claim Refund (${eth100Str})</button>`;
        } else if (statusIdx === 1 && (!ag.ms1 || !ag.ms1.completed)) {
          if (hasRemaining && statusIdx !== 4 && statusIdx !== 7) {
            actionsHtml += `<button class="btn btn-sm btn-danger px-3 fw-bold" onclick="App.cancelMissedPickupShipment(${ag.id}, this)">❌ Cancel Shipment & Claim Refund (${eth100Str} • Carrier Missed Pickup)</button>`;
          }
        } else if (statusIdx === 1 && ag.ms1 && ag.ms1.completed && !ag.ms1.approved) {
          if (ag.ms1SubmittedOnTime) {
            actionsHtml += `<button class="btn btn-sm btn-warning px-3 fw-bold shadow-sm text-dark" onclick="App.validatePickupAndClaimRefund(${ag.id}, this)">🚚 Validate On-Time Pickup (${eth30Str}) & Claim 70% Refund (${eth70Str})</button>`;
          } else {
            actionsHtml += `<button class="btn btn-sm btn-warning px-3 fw-bold shadow-sm text-dark" onclick="App.validatePickupAndClaimRefund(${ag.id}, this)">🚚 Validate Late Pickup & Claim 100% Refund (${eth100Str})</button>`;
          }
        } else {
          // Pickup completed: cargo is in transit or late delivery
          if (ag.ms2 && ag.ms2.completed && !ag.ms2.approved) {
            if (ag.ms2SubmittedOnTime) {
              actionsHtml += `<button class="btn btn-sm btn-success px-3 fw-bold shadow-sm" onclick="App.approveMilestone(${ag.id}, 1, this)">✅ Approve Delivery (Release ${eth70Str})</button>`;
            } else {
              if (hasRemaining) {
                actionsHtml += `<button class="btn btn-sm btn-success px-3 fw-bold shadow-sm" onclick="App.validateLateDelivery(${ag.id}, this)">💰 Claim 70% Refund (${eth70Str}) & Validate Late Delivery Done</button>`;
              } else {
                actionsHtml += `<button class="btn btn-sm btn-success px-3 fw-bold shadow-sm" onclick="App.validateLateDelivery(${ag.id}, this)">✅ Validate Late Delivery Done (Confirm Cargo Received)</button>`;
              }
              actionsHtml += `<button class="btn btn-sm btn-outline-danger px-3 fw-bold ms-2" onclick="App.openRejectMilestoneModal(${ag.id}, 1)">❌ Reject Submission</button>`;
            }
          } else if (!ag.ms2 || !ag.ms2.completed) {
            if (hasRemaining && statusIdx !== 4 && statusIdx !== 3) {
              actionsHtml += `<button class="btn btn-sm btn-danger px-3 fw-bold shadow-sm" onclick="App.claimTimeoutRefund(${ag.id}, this)">⏰ Claim 70% Overdue Escrow Refund (${eth70Str})</button>`;
            }
          }
        }
      } else {
        if (statusIdx === 0) {
          actionsHtml += `<button class="btn btn-sm btn-outline-danger px-3" onclick="App.cancelAgreement(${ag.id}, this)">❌ Cancel Agreement (${eth100Str})</button>`;
        }
        if (statusIdx === 1 && (!ag.ms1 || !ag.ms1.completed)) {
          actionsHtml += `<button class="btn btn-sm btn-outline-danger px-3" onclick="App.cancelAgreement(${ag.id}, this)">❌ Cancel Before Pickup (${eth100Str})</button>`;
        }
        if (statusIdx === 1 && ag.ms1 && ag.ms1.completed && !ag.ms1.approved) {
          actionsHtml += `<button class="btn btn-sm btn-primary px-3 fw-bold" onclick="App.approveMilestone(${ag.id}, 0, this)">✅ Approve Pickup (Release ${eth30Str})</button>`;
          actionsHtml += `<button class="btn btn-sm btn-outline-danger px-3 fw-bold ms-2" onclick="App.openRejectMilestoneModal(${ag.id}, 0)">❌ Reject Submission</button>`;
        }
        if (statusIdx === 2 && ag.ms2 && ag.ms2.completed && !ag.ms2.approved) {
          actionsHtml += `<button class="btn btn-sm btn-success px-3 fw-bold" onclick="App.approveMilestone(${ag.id}, 1, this)">✅ Approve Delivery (Release ${eth70Str})</button>`;
          actionsHtml += `<button class="btn btn-sm btn-outline-danger px-3 fw-bold ms-2" onclick="App.openRejectMilestoneModal(${ag.id}, 1)">❌ Reject Submission</button>`;
        }
      }
    } else if (isCarrier) {
      const nowSec = this.getNowSec();
      const isPastDeadline = ag.deadline && nowSec > parseInt(ag.deadline);

      if (statusIdx === 0) {
        if (!isPastDeadline) {
          actionsHtml += `<button class="btn btn-sm btn-outline-danger px-3" onclick="App.rejectCarrierShipment(${ag.id}, this)">❌ Reject Freight Contract</button>`;
          actionsHtml += `<button class="btn btn-sm btn-success px-3 fw-bold" onclick="App.acceptCarrierShipment(${ag.id}, this)">✅ Accept Freight Contract</button>`;
        } else {
          actionsHtml += `<span class="badge bg-secondary text-light px-3 py-1">⚠️ Offer Expired</span>`;
        }
      }
      if (statusIdx === 1 && (!ag.ms1 || !ag.ms1.completed)) {
        if (!isPastDeadline) {
          actionsHtml += `<button class="btn btn-sm btn-primary px-3 fw-bold" onclick="App.openCarrierProofModal(${ag.id}, 0)">🚚 Submit Pickup Proof (${eth30Str})</button>`;
        } else {
          actionsHtml += `<button class="btn btn-sm btn-warning text-dark px-3 fw-bold border-warning shadow-sm me-2" onclick="App.openCarrierProofModal(${ag.id}, 0)">⚠️ Submit Late Pickup Proof (0 ETH • Overdue)</button>`;
        }
      }
      if ((statusIdx === 2 || (statusIdx === 4 && ag.ms1 && ag.ms1.completed)) && (!ag.ms2 || !ag.ms2.completed)) {
        if (isPastDeadline || statusIdx === 4) {
          actionsHtml += `<button class="btn btn-sm btn-warning text-dark px-3 fw-bold border-warning shadow-sm" onclick="App.openCarrierProofModal(${ag.id}, 1)">⚠️ Submit Late Delivery Proof (0 ETH • Overdue)</button>`;
        } else {
          actionsHtml += `<button class="btn btn-sm btn-success px-3 fw-bold" onclick="App.openCarrierProofModal(${ag.id}, 1)">🏁 Submit Delivery Proof (${eth70Str})</button>`;
        }
      } else if ((statusIdx === 2 || statusIdx === 4) && ag.ms2 && ag.ms2.completed && !ag.ms2.approved) {
        if (ag.ms2SubmittedOnTime) {
          actionsHtml += `<span class="badge bg-success bg-opacity-25 border border-success text-success px-3 py-1 fw-bold">⏳ Submitted On Time • Awaiting Shipper Approval (${eth70Str})</span>`;
        } else if (isPastDeadline || statusIdx === 4) {
          actionsHtml += `<span class="badge bg-warning bg-opacity-25 border border-warning text-warning px-3 py-1 fw-bold">⏳ Awaiting Shipper Validation (Late Delivery Done)</span>`;
        } else {
          actionsHtml += `<span class="badge bg-warning bg-opacity-25 border border-warning text-warning px-3 py-1 fw-bold">⏳ Awaiting Shipper Final Settlement (${eth70Str})</span>`;
        }
      }
    }

    actionsHtml += `
      <button type="button" class="btn btn-secondary btn-sm px-4" data-bs-dismiss="modal">Close</button>
    `;

    const actionContainer = document.getElementById("modalActionButtonsContainer");
    if (actionContainer) actionContainer.innerHTML = actionsHtml;

    // 5. Open Modal
    try {
      if (!modalEl._hasHideListener) {
        modalEl._hasHideListener = true;
        modalEl.addEventListener("hidden.bs.modal", () => {
          App.activeDetailAgreementId = null;
        });
      }
      if (typeof bootstrap !== "undefined" && bootstrap.Modal) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
      } else {
        modalEl.classList.add("show");
        modalEl.style.display = "block";
      }
    } catch (e) {
      console.error("Error opening shipment detail modal:", e);
    }
  },

  // On-Chain Actions
  submitMilestone: function (id, msIndex) {
    this.openCarrierProofModal(id, msIndex);
  },

  approveMilestone: async function (id, msIndex, btn) {
    const ag = this.allAgreements.find(a => String(a.id) === String(id));
    const nowSec = this.getNowSec();
    const isPastDeadline = ag && ag.deadline && nowSec > parseInt(ag.deadline);
    const isLateOrRefunded = isPastDeadline || (ag && parseInt(ag.status) === 4);

    if (msIndex === 1 && isLateOrRefunded && !ag.ms2SubmittedOnTime) {
      return this.validateLateDelivery(id, btn);
    }

    const pct = msIndex === 0 ? 30 : 70;
    const amtStr = ag ? this.formatPercentAmount(ag.totalValue, pct) : `${pct}%`;
    const title = msIndex === 0 ? "Approve Pickup Milestone" : "Approve Final Delivery Milestone";
    const repAward = msIndex === 0 ? "+50 CRT" : "+100 CRT";
    const onTimeNote = (msIndex === 1 && isPastDeadline && ag.ms2SubmittedOnTime) ?
      "\n\n⭐ On-Time Delivery: Carrier submitted completion proof before the deadline expired. Payout and full reputation are released without penalty." : "";

    const ok = await this.showConfirmDialog({
      title,
      icon: "✅",
      message: `Approve ${title} for Freight Contract #${id} and release ${amtStr} to Carrier?${onTimeNote}\n\n(Carrier fleet will be awarded ${repAward} reputation tokens).`,
      okText: "Release Payout",
      cancelText: "Cancel",
      okBtnClass: "btn-success"
    });
    if (!ok) {
      this.showToast("Action Cancelled", "Milestone approval was cancelled by user.", "cancel");
      return;
    }

    try {
      this.showTxLoading("Disbursing Milestone Payout", `Confirming release of ${amtStr} in MetaMask...`, "Smart contract will disburse ETH to carrier wallet", btn);
      await this.escrowContract.methods.approveMilestonePayout(id, msIndex).send({ from: this.account });
      this.showToast("Milestone Approved", `Milestone payout approved & ${amtStr} disbursed to Carrier wallet!`, "success", 5000);
      this.hideShipmentDetailModal();
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Approval Cancelled", "Milestone approval transaction was cancelled in MetaMask.", "cancel");
      } else {
        this.showToast("Approval Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  cancelAgreement: async function (id, btn) {
    const ag = this.allAgreements.find(a => String(a.id) === String(id));
    const nowSec = this.getNowSec();
    const isPastDeadline = ag && ag.deadline && nowSec > parseInt(ag.deadline);
    const statusIdx = ag ? parseInt(ag.status) : 0;
    const eth100Str = ag ? this.formatPercentAmount(ag.totalValue, 100) : "100%";

    if (statusIdx === 1 && isPastDeadline) {
      return this.cancelMissedPickupShipment(id, btn);
    }

    let title = "Cancel Freight Agreement";
    let confirmMsg = `Cancel Freight Contract #${id} and receive 100% refund (${eth100Str}) of the escrow deposit?`;
    let cancelText = "Keep Agreement";

    if (statusIdx === 0 && isPastDeadline) {
      title = "Cancel Expired Offer (Not Accepted)";
      confirmMsg = `Offer for Freight Contract #${id} expired without carrier acceptance.\n\nThis shipment is no longer active and cannot be accepted by any carrier.\n\nCancel offer and claim 100% refund (${eth100Str}) back to your wallet? (No penalty to carrier).`;
      cancelText = "Close";
    }

    const ok = await this.showConfirmDialog({
      title,
      icon: "⏰",
      message: confirmMsg,
      okText: "Cancel & Claim 100% Refund",
      cancelText: cancelText,
      okBtnClass: "btn-danger"
    });
    if (!ok) {
      this.showToast("Action Cancelled", "Agreement cancellation was cancelled by user.", "cancel");
      return;
    }

    try {
      this.showTxLoading("Cancelling Agreement", "Processing cancellation and refund in MetaMask...", "100% escrow will return to your wallet", btn);
      if (this.escrowContract.methods.cancelAgreement) {
        await this.escrowContract.methods.cancelAgreement(id).send({ from: this.account });
      } else {
        await this.escrowContract.methods.cancelBeforePickup(id).send({ from: this.account });
      }
      this.lastRefundedAgreement = ag;
      this.showToast("Agreement Cancelled", `Agreement cancelled and 100% escrow (${eth100Str}) refunded!`, "success", 5000);
      this.hideShipmentDetailModal();
      await this.refreshUI();

      if (statusIdx === 0 && ag) {
        const titleEl = document.getElementById("rescheduleModalCargoTitle");
        if (titleEl) titleEl.innerHTML = `Cargo: <b>${ag.cargoTitle || `Freight Contract #${id}`}</b> (Refunded: ${parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4)} ETH)`;
        const reschedModal = document.getElementById("rescheduleShipmentModal");
        if (reschedModal && typeof bootstrap !== "undefined" && bootstrap.Modal) {
          bootstrap.Modal.getOrCreateInstance(reschedModal).show();
        }
      }
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Cancellation Cancelled", "Cancellation transaction was cancelled in MetaMask.", "cancel");
      } else {
        this.showToast("Cancellation Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  cancelMissedPickupShipment: async function (id, btn) {
    const ag = this.allAgreements.find(a => String(a.id) === String(id));
    const eth100Str = ag ? this.formatPercentAmount(ag.totalValue, 100) : "100%";

    const confirmPrompt = `Carrier accepted Freight Contract #${id} but failed to pick up cargo before the delivery deadline expired.\n\nCancel this shipment and claim a 100% escrow refund (${eth100Str}) back to your wallet?\n\n(This will mark the agreement as Cancelled & Refunded, and penalize the carrier 150 CRT for missing the deadline).`;

    const ok = await this.showConfirmDialog({
      title: "Cancel Shipment (Carrier Missed Pickup)",
      icon: "❌",
      message: confirmPrompt,
      okText: "Cancel & Claim 100% Refund",
      cancelText: "Keep Shipment",
      okBtnClass: "btn-danger"
    });
    if (!ok) {
      this.showToast("Action Cancelled", "Cancellation was cancelled by user.", "cancel");
      return;
    }

    try {
      this.showTxLoading("Cancelling Shipment", "Processing missed pickup cancellation in MetaMask...", "Penalizes carrier and refunds 100% escrow", btn);
      if (this.escrowContract.methods.cancelAgreement) {
        await this.escrowContract.methods.cancelAgreement(id).send({ from: this.account });
      } else {
        await this.escrowContract.methods.claimTimeoutRefund(id).send({ from: this.account });
      }
      this.lastRefundedAgreement = ag;
      this.showToast("Shipment Cancelled", `Freight Contract #${id} cancelled and 100% escrow refunded due to missed pickup!`, "success", 5000);
      this.hideShipmentDetailModal();
      await this.refreshUI();

      if (ag) {
        const titleEl = document.getElementById("rescheduleModalCargoTitle");
        if (titleEl) titleEl.innerHTML = `Cargo: <b>${ag.cargoTitle || `Freight Contract #${id}`}</b> (Refunded: ${parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4)} ETH)`;
        const reschedModal = document.getElementById("rescheduleShipmentModal");
        if (reschedModal && typeof bootstrap !== "undefined" && bootstrap.Modal) {
          bootstrap.Modal.getOrCreateInstance(reschedModal).show();
        }
      }
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Cancellation Cancelled", "Cancellation transaction was cancelled in MetaMask.", "cancel");
      } else {
        this.showToast("Cancellation Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  },

  openRejectMilestoneModal: function (id, msIndex) {
    const ag = (this.allAgreements || []).find(a => String(a.id) === String(id));
    if (!ag) return;

    document.getElementById("rejectMilestoneAgreementId").value = id;
    document.getElementById("rejectMilestoneIndex").value = msIndex;
    document.getElementById("rejectMilestoneTargetAgreement").innerText = ag.cargoTitle || `Freight Contract #${id}`;
    
    const badge = document.getElementById("rejectMilestoneTargetBadge");
    if (badge) {
      badge.innerText = msIndex === 0 ? "Milestone 1: Cargo Pickup Verification" : "Milestone 2: Final Delivery Verification";
    }

    const input = document.getElementById("rejectMilestoneReasonInput");
    if (input) input.value = "";

    const modalEl = document.getElementById("rejectMilestoneModal");
    if (modalEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  },

  confirmRejectMilestoneProof: async function (btn) {
    const id = document.getElementById("rejectMilestoneAgreementId").value;
    const msIndex = parseInt(document.getElementById("rejectMilestoneIndex").value);
    const reasonInput = document.getElementById("rejectMilestoneReasonInput");
    const reason = (reasonInput ? reasonInput.value : "").trim();

    if (!reason) {
      this.showToast("Missing Reason", "Please enter a specific reason why this proof was rejected.", "error");
      if (reasonInput) {
        reasonInput.classList.add("form-field-invalid");
        reasonInput.focus();
        reasonInput.addEventListener("input", () => reasonInput.classList.remove("form-field-invalid"), { once: true });
      }
      return;
    }

    try {
      this.showTxLoading("Rejecting Milestone Proof", `Recording rejection of Milestone ${msIndex + 1} on blockchain...`, "Notifies carrier to re-inspect and resubmit proof", btn);
      await this.escrowContract.methods.rejectMilestoneProof(id, msIndex, reason).send({ from: this.account });

      this.showToast("Proof Rejected", `Milestone ${msIndex + 1} proof rejected. Carrier has been notified to resubmit!`, "cancel", 5000);

      const modalEl = document.getElementById("rejectMilestoneModal");
      if (modalEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      }
      this.hideShipmentDetailModal();
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      if (err.code === 4001 || (err.message && (err.message.includes("denied") || err.message.includes("rejected")))) {
        this.showToast("Rejection Cancelled", "Rejection transaction was cancelled in MetaMask.", "cancel");
      } else {
        this.showToast("Rejection Failed", err.message || String(err), "error");
      }
    } finally {
      this.hideTxLoading(btn);
    }
  }
};

window.addEventListener("load", () => App.init());
