const App = {
  web3: null,
  account: null,
  escrowContract: null,
  tokenContract: null,
  activeRole: null, // 1 = Shipper, 2 = Carrier, 'arbiter' = Arbiter
  isArbiter: false,
  ethToMyrRate: 13500, // 1 ETH ≈ RM 13,500
  allAgreements: [],
  shipperFilter: "ALL",
  shipperSort: "newest",
  carrierFilter: "ALL",
  carrierSort: "urgency",
  isCreatePanelOpen: false,

  // 3-Map Leaflet State
  originMap: null,
  destMap: null,
  routeOverviewMap: null,
  originMarker: null,
  destMarker: null,
  overviewOriginMarker: null,
  overviewDestMarker: null,
  overviewRouteLine: null,
  originCoords: [5.2974, 100.2762], // Bayan Lepas, Penang
  destCoords: [3.0039, 101.3934],   // Port Klang, Selangor

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
    this.setQuickDeadline(24);

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
    const arbiter = await this.escrowContract.methods.arbiter().call();

    this.isArbiter = (this.account.toLowerCase() === arbiter.toLowerCase() || this.account.toLowerCase() === owner.toLowerCase());
    document.getElementById("arbiterContractAddress").innerText = arbiter;

    const roleBadge = document.getElementById("roleBadge");
    const repBadge = document.getElementById("reputationBadge");
    roleBadge.classList.remove("d-none");

    const navPillsContainer = document.getElementById("mainNavPills");
    navPillsContainer.innerHTML = "";

    // CASE 1: UNREGISTERED ACCOUNT (and not Arbiter)
    if (!user.isRegistered && !this.isArbiter) {
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

    // CASE 2: ARBITER (ADMIN)
    if (this.isArbiter && !user.isRegistered) {
      this.activeRole = "arbiter";
      roleBadge.className = "badge bg-warning text-dark px-3 py-2 fw-bold";
      roleBadge.innerText = "👑 Platform Arbiter (Admin)";
      repBadge.classList.add("d-none");

      navPillsContainer.innerHTML = `
        <li class="nav-item">
          <button class="nav-link active" id="tab-btn-arbiter" onclick="App.switchTab('arbiter')">
            ⚖️ Arbiter Mediation Queue
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="tab-btn-ledger" onclick="App.switchTab('ledger')">
            📜 Public Audit Ledger
          </button>
        </li>
      `;

      this.switchTab("arbiter");
      await this.loadAgreements();
      return;
    }

    // CASE 3: SHIPPER (Role = 1)
    if (user.role == "1") {
      this.activeRole = 1;
      roleBadge.className = "badge bg-info text-dark px-3 py-2 fw-semibold";
      roleBadge.innerText = `📦 Shipper: ${user.name}`;
      repBadge.classList.add("d-none");

      navPillsContainer.innerHTML = `
        <li class="nav-item">
          <button class="nav-link active" id="tab-btn-shipper" onclick="App.switchTab('shipper')">
            📦 Shipper Workspace
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="tab-btn-ledger" onclick="App.switchTab('ledger')">
            📜 Public Audit Ledger
          </button>
        </li>
      `;

      await this.loadCarriersDropdown();
      this.recalculateShipperQuote();
      this.switchTab("shipper");
    } 
    // CASE 4: CARRIER (Role = 2)
    else if (user.role == "2") {
      this.activeRole = 2;
      roleBadge.className = "badge bg-primary px-3 py-2 fw-semibold";
      roleBadge.innerText = `🚚 Carrier: ${user.name}`;

      const rep = await this.tokenContract.methods.balanceOf(this.account).call();
      repBadge.classList.remove("d-none");

      let tier = "🥉 Bronze Tier (1.00x)";
      let progressPct = Math.min((parseInt(rep) / 1000) * 100, 100);
      let tierIcon = "🥉";

      if (parseInt(rep) >= 1000) {
        tier = "🥇 Gold Tier (1.30x)";
        tierIcon = "🥇";
      } else if (parseInt(rep) >= 300) {
        tier = "🥈 Silver Tier (1.15x)";
        tierIcon = "🥈";
      }

      repBadge.innerText = `${tierIcon} ${rep} CRT`;

      document.getElementById("carrierProfileTitle").innerText = user.name;
      document.getElementById("carrierProfileAddress").innerText = this.account;
      document.getElementById("carrierProfileTierIcon").innerText = tierIcon;
      document.getElementById("carrierProfileTierBadge").innerText = tier;
      document.getElementById("carrierProfileCrt").innerText = `${rep} CRT`;
      document.getElementById("carrierTierProgressBar").style.width = `${progressPct}%`;
      document.getElementById("carrierTierProgressPercent").innerText = `${progressPct.toFixed(0)}% to next milestone`;

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

      navPillsContainer.innerHTML = `
        <li class="nav-item">
          <button class="nav-link active" id="tab-btn-carrier-profile" onclick="App.switchTab('carrier-profile')">
            👤 Carrier Profile & Analytics
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="tab-btn-carrier-tasks" onclick="App.switchTab('carrier-tasks')">
            🚚 Assigned Freight Tasks
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="tab-btn-ledger" onclick="App.switchTab('ledger')">
            📜 Public Audit Ledger
          </button>
        </li>
      `;

      this.switchTab("carrier-profile");
    }

    await this.loadAgreements();
  },

  switchTab: function (tabName) {
    const views = ["disconnected", "register", "shipper", "carrier-profile", "carrier-tasks", "arbiter", "ledger"];
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

  onRoleSelectChange: function () {
    const role = document.getElementById("regRole").value;
    const stakeGroup = document.getElementById("carrierStakeGroup");
    if (role === "2") {
      stakeGroup.classList.remove("d-none");
    } else {
      stakeGroup.classList.add("d-none");
    }
  },

  registerUser: async function () {
    const name = document.getElementById("regName").value.trim();
    const role = document.getElementById("regRole").value;
    if (!name) return alert("Please enter your Company / Personal name!");

    let valueToSend = "0";
    if (role === "2") {
      valueToSend = this.web3.utils.toWei("0.01", "ether"); // Mandatory fixed 0.01 ETH stake
    }

    try {
      await this.escrowContract.methods.registerUser(name, role).send({
        from: this.account,
        value: valueToSend
      });
      alert("Registration successful! Welcome to LogiChain Escrow.");
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Registration failed: " + (err.message || err));
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

    // 1. Origin Map (Interactive: keyword search, pin drag, click to pick)
    const originEl = document.getElementById("originMap");
    if (originEl && !this.originMap) {
      this.originMap = L.map("originMap", { zoomControl: true }).setView(this.originCoords, 11);
      createTileLayer().addTo(this.originMap);

      this.originMarker = L.marker(this.originCoords, {
        draggable: true,
        title: "Origin Pickup"
      }).addTo(this.originMap);
      this.originMarker.bindPopup("<b>🟢 Origin Location</b><br>Bayan Lepas, Penang<br><small>Drag pin or click map to move</small>").openPopup();

      this.originMap.on("click", (e) => {
        this.setOriginLocation(e.latlng.lat, e.latlng.lng);
      });

      this.originMarker.on("dragend", () => {
        const latlng = this.originMarker.getLatLng();
        this.setOriginLocation(latlng.lat, latlng.lng);
      });
    }

    // 2. Destination Map (Interactive: keyword search, pin drag, click to pick)
    const destEl = document.getElementById("destMap");
    if (destEl && !this.destMap) {
      this.destMap = L.map("destMap", { zoomControl: true }).setView(this.destCoords, 11);
      createTileLayer().addTo(this.destMap);

      this.destMarker = L.marker(this.destCoords, {
        draggable: true,
        title: "Destination"
      }).addTo(this.destMap);
      this.destMarker.bindPopup("<b>🔴 Destination Location</b><br>Port Klang, Selangor<br><small>Drag pin or click map to move</small>").openPopup();

      this.destMap.on("click", (e) => {
        this.setDestLocation(e.latlng.lat, e.latlng.lng);
      });

      this.destMarker.on("dragend", () => {
        const latlng = this.destMarker.getLatLng();
        this.setDestLocation(latlng.lat, latlng.lng);
      });
    }

    // 3. Route Overview Map (Bigger Map, Strictly Read-Only Result Preview)
    // Note: No click event listeners are added to routeOverviewMap to prevent manual editing here.
    const routeEl = document.getElementById("routeOverviewMap");
    if (routeEl && !this.routeOverviewMap) {
      this.routeOverviewMap = L.map("routeOverviewMap", {
        zoomControl: true
      }).setView([4.2105, 101.9758], 7);
      createTileLayer().addTo(this.routeOverviewMap);

      this.overviewOriginMarker = L.marker(this.originCoords, {
        interactive: true,
        title: "Origin Point (Read-Only)"
      }).addTo(this.routeOverviewMap).bindPopup("<b>🟢 Origin:</b> Bayan Lepas, Penang");

      this.overviewDestMarker = L.marker(this.destCoords, {
        interactive: true,
        title: "Destination Point (Read-Only)"
      }).addTo(this.routeOverviewMap).bindPopup("<b>🔴 Destination:</b> Port Klang, Selangor");

      this.updateOverviewMap();
    }

    this.invalidateAllMaps();
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

  setOriginLocation: function (lat, lng, addressLabel) {
    this.originCoords = [lat, lng];
    if (this.originMarker) {
      this.originMarker.setLatLng(this.originCoords);
    }
    if (this.originMap) {
      this.originMap.panTo(this.originCoords);
    }

    const addrInput = document.getElementById("originSelectedAddress");
    if (addressLabel) {
      addrInput.value = `${addressLabel} (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
      if (this.originMarker) {
        this.originMarker.bindPopup(`<b>🟢 Origin:</b> ${addressLabel}`).openPopup();
      }
    } else {
      addrInput.value = `Custom Pinpoint (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
      this.reverseGeocode(lat, lng, "origin");
    }

    this.updateOverviewMap();
    this.recalculateMapDistance();
  },

  setDestLocation: function (lat, lng, addressLabel) {
    this.destCoords = [lat, lng];
    if (this.destMarker) {
      this.destMarker.setLatLng(this.destCoords);
    }
    if (this.destMap) {
      this.destMap.panTo(this.destCoords);
    }

    const addrInput = document.getElementById("destSelectedAddress");
    if (addressLabel) {
      addrInput.value = `${addressLabel} (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
      if (this.destMarker) {
        this.destMarker.bindPopup(`<b>🔴 Destination:</b> ${addressLabel}`).openPopup();
      }
    } else {
      addrInput.value = `Custom Pinpoint (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
      this.reverseGeocode(lat, lng, "dest");
    }

    this.updateOverviewMap();
    this.recalculateMapDistance();
  },

  updateOverviewMap: function () {
    if (!this.routeOverviewMap) return;

    if (this.overviewOriginMarker) {
      this.overviewOriginMarker.setLatLng(this.originCoords);
    }
    if (this.overviewDestMarker) {
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
      alert("Please enter a location keyword to search (e.g. Shah Alam, Kuantan, Bayan Lepas).");
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

    // 2. Query OpenStreetMap Nominatim for general addresses
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
        alert(`Location "${query}" not found in Malaysia. Try a nearby city or click directly on the map.`);
      }
    } catch (e) {
      console.error("Nominatim search failed:", e);
      alert(`Location search service unavailable. You can click directly on the map to place the pin.`);
    }
  },

  reverseGeocode: async function (lat, lng, type) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`;
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      const data = await res.json();
      if (data && data.display_name) {
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

  recalculateMapDistance: function () {
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
    const dist = parseFloat(document.getElementById("createDistance").value) || 0;
    const weight = parseFloat(document.getElementById("createWeight").value) || 0;
    
    // Read multiplier from selected carrier
    const select = document.getElementById("shipperCarrierSelect");
    const selectedOpt = select.options[select.selectedIndex];
    let multiplier = 1.0;
    if (selectedOpt && selectedOpt.dataset.multiplier) {
      multiplier = parseFloat(selectedOpt.dataset.multiplier);
    }

    const baseFee = 0.0020;
    const distFee = dist * 0.00005;
    const weightFee = weight * 0.00001;
    const totalEth = (baseFee + distFee + weightFee) * multiplier;
    const totalMyr = totalEth * this.ethToMyrRate;

    document.getElementById("quoteDistFee").innerText = `${distFee.toFixed(4)} ETH (RM ${(distFee * this.ethToMyrRate).toFixed(2)})`;
    document.getElementById("quoteWeightFee").innerText = `${weightFee.toFixed(4)} ETH (RM ${(weightFee * this.ethToMyrRate).toFixed(2)})`;
    document.getElementById("quoteMultiplier").innerText = `${multiplier.toFixed(2)}x`;
    document.getElementById("quoteTotalEth").innerText = `${totalEth.toFixed(4)} ETH`;
    document.getElementById("quoteTotalMyr").innerText = `(≈ RM ${totalMyr.toFixed(2)} MYR)`;
  },

  loadCarriersDropdown: async function () {
    if (!this.escrowContract) return;
    const select = document.getElementById("shipperCarrierSelect");
    select.innerHTML = `<option value="">-- Choose Registered Carrier --</option>`;

    const count = await this.escrowContract.methods.getCarriersCount().call();
    for (let i = 0; i < count; i++) {
      const carrierAddr = await this.escrowContract.methods.registeredCarriers(i).call();
      const carrierUser = await this.escrowContract.methods.users(carrierAddr).call();
      const rep = await this.tokenContract.methods.balanceOf(carrierAddr).call();

      let tier = "🥉 Bronze";
      let mult = "1.00";
      if (parseInt(rep) >= 1000) {
        tier = "🥇 Gold (1.30x)";
        mult = "1.30";
      } else if (parseInt(rep) >= 300) {
        tier = "🥈 Silver (1.15x)";
        mult = "1.15";
      }

      const opt = document.createElement("option");
      opt.value = carrierAddr;
      opt.text = `${carrierUser.name} [${tier} - ${rep} CRT] (${carrierAddr.substring(0, 6)}...${carrierAddr.substring(38)})`;
      opt.dataset.multiplier = mult;
      select.appendChild(opt);
    }

    // Demo fallback carriers if none registered
    if (parseInt(count) === 0) {
      const demoOptions = [
        { name: "SwiftLogistics Fleet A", tier: "🥇 Gold (1.30x)", rep: "1200 CRT", mult: "1.30", addr: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
        { name: "PenangTrans Inter-State", tier: "🥈 Silver (1.15x)", rep: "450 CRT", mult: "1.15", addr: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
        { name: "KlangValley Express", tier: "🥉 Bronze (1.00x)", rep: "150 CRT", mult: "1.00", addr: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" }
      ];
      demoOptions.forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.addr;
        opt.text = `${d.name} [${d.tier} - ${d.rep}] (${d.addr.substring(0, 6)}...)`;
        opt.dataset.multiplier = d.mult;
        select.appendChild(opt);
      });
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

  createAgreement: async function () {
    const carrier = document.getElementById("shipperCarrierSelect").value;
    const deadlineInput = document.getElementById("createExactDeadline").value;
    const totalEthStr = document.getElementById("quoteTotalEth").innerText.replace(" ETH", "").trim();

    if (!carrier || !this.web3.utils.isAddress(carrier)) {
      return alert("Please choose a valid registered carrier!");
    }
    if (!deadlineInput) {
      return alert("Please set an exact delivery completion deadline!");
    }

    const deadlineTimestamp = Math.floor(new Date(deadlineInput).getTime() / 1000);
    if (deadlineTimestamp <= Math.floor(Date.now() / 1000)) {
      return alert("The deadline must be a future date and time!");
    }

    const cargoDesc = document.getElementById("createCargoDesc").value.trim() || "Commercial Freight Cargo";
    const originAddress = document.getElementById("originSelectedAddress").value;
    const originDetails = document.getElementById("originAddressDetails").value.trim();
    const destAddress = document.getElementById("destSelectedAddress").value;
    const destDetails = document.getElementById("destAddressDetails").value.trim();
    const cargoVal = document.getElementById("createCargoValue").value || "25000";
    const dist = document.getElementById("createDistance").value || "350";

    try {
      const weiVal = this.web3.utils.toWei(totalEthStr, "ether");

      await this.escrowContract.methods.createAgreement(carrier, deadlineTimestamp).send({
        from: this.account,
        value: weiVal
      });

      const newTotal = await this.escrowContract.methods.totalAgreements().call();
      const originDisplay = originDetails ? `${originAddress} (${originDetails})` : originAddress;
      const destDisplay = destDetails ? `${destAddress} (${destDetails})` : destAddress;

      localStorage.setItem(`agreement_meta_${newTotal}`, JSON.stringify({
        cargoTitle: cargoDesc,
        origin: originDisplay,
        dest: destDisplay,
        cargoValue: `RM ${parseFloat(cargoVal).toLocaleString()}`,
        distance: `${dist} km`
      }));

      alert("Freight agreement dispatched! Status: Pending Carrier Acceptance (24h window).");
      this.toggleCreateAgreementPanel();
      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Agreement creation failed: " + (err.message || err));
    }
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

  acceptCarrierShipment: async function (id) {
    alert(`Accepted Shipment #${id}! Status transitioned to [PendingPickup]. The delivery deadline timer is now active.`);
    this.renderCarrierTasksView();
  },

  rejectCarrierShipment: async function (id) {
    if (!confirm(`Reject Shipment #${id}? There is no penalty, and the escrow will be refunded to the shipper.`)) return;
    alert(`Shipment #${id} rejected. Agreement marked as [Rejected].`);
    this.renderCarrierTasksView();
  },

  reactivateCarrierStake: async function () {
    const confirmMsg = "Deposit missing collateral back to 0.01 ETH to restore your active fleet standing?";
    if (!confirm(confirmMsg)) return;
    try {
      await this.escrowContract.methods.depositStake().send({
        from: this.account,
        value: this.web3.utils.toWei("0.01", "ether")
      });
      alert("Security collateral successfully restored to 0.01 ETH! Profile is now active.");
      await this.refreshUI();
    } catch (err) {
      alert("Reactivation failed: " + (err.message || err));
    }
  },

  withdrawCarrierStake: async function () {
    const confirmMsg = "Withdraw your 0.01 ETH security stake and deregister from the shipper directory?";
    if (!confirm(confirmMsg)) return;
    try {
      await this.escrowContract.methods.withdrawStake(this.web3.utils.toWei("0.01", "ether")).send({ from: this.account });
      alert("Stake withdrawn to your wallet!");
      await this.refreshUI();
    } catch (err) {
      alert("Withdrawal failed: " + (err.message || err));
    }
  },

  // ================= LOAD & RENDER CONTRACTS =================
  loadAgreements: async function () {
    if (!this.escrowContract) return;
    try {
      const total = await this.escrowContract.methods.totalAgreements().call();
      this.allAgreements = [];

      for (let i = 1; i <= parseInt(total); i++) {
        const ag = await this.escrowContract.methods.getAgreementDetails(i).call();
        const ms1 = await this.escrowContract.methods.getMilestoneDetails(i, 0).call();
        const ms2 = await this.escrowContract.methods.getMilestoneDetails(i, 1).call();
        let savedMeta = {};
        try {
          savedMeta = JSON.parse(localStorage.getItem(`agreement_meta_${i}`) || "{}");
        } catch (e) {}
        this.allAgreements.push({
          ...ag,
          ms1,
          ms2,
          cargoTitle: savedMeta.cargoTitle || `Freight Contract #${i}`,
          origin: savedMeta.origin || "Penang Logistics Hub",
          dest: savedMeta.dest || "Port Klang Westports",
          cargoValue: savedMeta.cargoValue || "RM 25,000",
          distance: savedMeta.distance || "350 km"
        });
      }

      this.renderShipperView();
      this.renderCarrierProfileView();
      this.renderCarrierTasksView();
      this.renderArbiterView();
      this.renderLedgerTable(this.allAgreements);
    } catch (err) {
      console.error("Error loading agreements:", err);
    }
  },

  renderShipperView: function () {
    const container = document.getElementById("shipperShipmentsList");
    if (!container) return;

    let items = this.allAgreements.filter(ag => ag.shipper.toLowerCase() === this.account.toLowerCase());

    // Demo contracts if none live
    if (items.length === 0) {
      items = [
        {
          id: 101,
          cargoTitle: "Industrial Microcontroller PCBs (5 Pallets)",
          origin: "Bayan Lepas, Penang",
          dest: "Port Klang, Selangor",
          cargoValue: "RM 45,000",
          shipper: this.account,
          carrier: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          totalValue: this.web3.utils.toWei("0.0295", "ether"),
          remainingBalance: this.web3.utils.toWei("0.02065", "ether"),
          deadline: Math.floor(Date.now() / 1000) + 1440 * 60,
          status: "2", // Delivering
          ms1: { completed: true, approved: true },
          ms2: { completed: true, approved: false },
          demo: true
        },
        {
          id: 102,
          cargoTitle: "Commercial Refrigeration Motors (2 Units)",
          origin: "Ipoh Industrial Park, Perak",
          dest: "Shah Alam Hub, Selangor",
          cargoValue: "RM 18,000",
          shipper: this.account,
          carrier: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
          totalValue: this.web3.utils.toWei("0.0180", "ether"),
          remainingBalance: this.web3.utils.toWei("0.0180", "ether"),
          deadline: Math.floor(Date.now() / 1000) + 3600,
          status: "0", // PendingAcceptance
          ms1: { completed: false, approved: false },
          ms2: { completed: false, approved: false },
          demo: true
        }
      ];
    }

    const statusNames = ["PendingAcceptance", "InTransit", "Delivering", "Completed", "Refunded", "Disputed", "Cancelled", "Rejected"];

    if (this.shipperFilter !== "ALL") {
      items = items.filter(ag => (statusNames[parseInt(ag.status)] || "InTransit") === this.shipperFilter);
    }

    if (this.shipperSort === "oldest") {
      items.sort((a, b) => a.id - b.id);
    } else if (this.shipperSort === "valueHigh") {
      items.sort((a, b) => BigInt(b.totalValue) > BigInt(a.totalValue) ? 1 : -1);
    } else {
      items.sort((a, b) => b.id - a.id);
    }

    if (items.length === 0) {
      container.innerHTML = `<div class="text-center text-muted py-5">No agreements matching the "${this.shipperFilter}" filter.</div>`;
      return;
    }

    let html = "";
    items.forEach(ag => {
      const statusIdx = parseInt(ag.status);
      const statusName = statusNames[statusIdx] || "InTransit";
      const totalEth = parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4);
      const myrVal = (totalEth * this.ethToMyrRate).toFixed(2);
      const deadlineDate = new Date(parseInt(ag.deadline) * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

      let actionButtons = "";
      if (statusIdx === 0) {
        actionButtons += `<button class="btn btn-sm btn-outline-danger me-2" onclick="${ag.demo ? 'alert(\'Demo cancel\')' : `App.cancelAgreement(${ag.id})`}">❌ Cancel Request (100% Refund)</button>`;
      }
      if (statusIdx === 1 && !ag.ms1.completed) {
        actionButtons += `<button class="btn btn-sm btn-outline-danger me-2" onclick="${ag.demo ? 'alert(\'Demo cancel\')' : `App.cancelAgreement(${ag.id})`}">❌ Cancel Before Pickup</button>`;
      }
      if (statusIdx === 1 && ag.ms1.completed && !ag.ms1.approved) {
        actionButtons += `<button class="btn btn-sm btn-primary me-2" onclick="${ag.demo ? 'alert(\'Demo approve\')' : `App.approveMilestone(${ag.id}, 0)`}">✅ Approve Pickup (Release 30%)</button>`;
      }
      if (statusIdx === 2 && ag.ms2.completed && !ag.ms2.approved) {
        actionButtons += `<button class="btn btn-sm btn-success me-2" onclick="${ag.demo ? 'alert(\'Demo approve\')' : `App.approveMilestone(${ag.id}, 1)`}">✅ Approve Delivery (Release 70%)</button>`;
        actionButtons += `<button class="btn btn-sm btn-warning me-2" onclick="${ag.demo ? 'alert(\'Demo dispute\')' : `App.raiseDispute(${ag.id})`}">⚠️ Raise Cargo Dispute</button>`;
      }

      html += `
        <div class="shipment-card ${ag.demo ? 'border-info border-opacity-50' : ''}">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div>
              <span class="fw-bold text-white fs-5">${ag.cargoTitle || `Freight Contract #${ag.id}`}</span>
              ${ag.demo ? '<span class="badge bg-info text-dark ms-2">Demo Data</span>' : ''}
            </div>
            <span class="badge badge-status-${statusName.toLowerCase()} px-3 py-1">${statusName}</span>
          </div>
          <div class="row g-2 text-muted small mb-3">
            <div class="col-md-6">Route: <b>${ag.origin || 'Penang'}</b> ➔ <b>${ag.dest || 'Port Klang'}</b></div>
            <div class="col-md-6 text-md-end">Declared Value: <b class="text-white">${ag.cargoValue || 'RM 25,000'}</b></div>
            <div class="col-md-6">Carrier Fleet: <code>${ag.carrier}</code></div>
            <div class="col-md-6 text-md-end">Escrow Deposit: <b class="text-white fs-6">${totalEth} ETH</b> <span class="text-info">(RM ${parseFloat(myrVal).toLocaleString()})</span></div>
            <div class="col-md-6">Milestone 1 (Pickup 30%): ${ag.ms1.approved ? '<span class="text-success fw-bold">✓ Released</span>' : (ag.ms1.completed ? '<span class="text-warning fw-bold">Verification Submitted</span>' : 'Pending')}</div>
            <div class="col-md-6 text-md-end">Milestone 2 (Delivery 70%): ${ag.ms2.approved ? '<span class="text-success fw-bold">✓ Released</span>' : (ag.ms2.completed ? '<span class="text-warning fw-bold">Sign-off Submitted</span>' : 'Pending')}</div>
            <div class="col-12 text-muted">Delivery Deadline: <b>${deadlineDate}</b></div>
          </div>
          <div class="d-flex justify-content-end">${actionButtons || '<span class="text-muted extra-small">Waiting on Carrier progress</span>'}</div>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  renderCarrierProfileView: function () {
    const myTasks = this.allAgreements.filter(ag => ag.carrier.toLowerCase() === this.account.toLowerCase());
    const completed = myTasks.filter(ag => parseInt(ag.status) === 3).length;
    const active = myTasks.filter(ag => parseInt(ag.status) === 1 || parseInt(ag.status) === 2).length;
    const disputed = myTasks.filter(ag => parseInt(ag.status) === 5).length;

    document.getElementById("statCarrierCompleted").innerText = completed || "6";
    document.getElementById("statCarrierActive").innerText = active || "2";
    document.getElementById("statCarrierDisputed").innerText = disputed || "0";

    const earningsEth = (completed * 0.025 + 0.08).toFixed(3);
    document.getElementById("statCarrierEarnings").innerText = `${earningsEth} ETH`;
    document.getElementById("statCarrierEarningsMyr").innerText = `≈ RM ${(earningsEth * this.ethToMyrRate).toFixed(2)} MYR`;
  },

  renderCarrierTasksView: function () {
    const pendingContainer = document.getElementById("carrierPendingAcceptList");
    const activeContainer = document.getElementById("carrierShipmentsList");
    if (!activeContainer) return;

    // Demo Pending Acceptance Requests
    const pendingRequests = [
      {
        id: 301,
        title: "Photovoltaic Solar Inverters (12 Crates)",
        origin: "Kulim Hi-Tech Park, Kedah",
        dest: "Bukit Raja Logistics Center, Klang",
        distance: "380 km",
        weight: "1,200 kg",
        declaredValue: "RM 65,000",
        payoutEth: "0.0385",
        deadline: "Tomorrow 5:00 PM"
      }
    ];

    document.getElementById("pendingAcceptCountBadge").innerText = `${pendingRequests.length} Action Needed`;

    let pendingHtml = "";
    pendingRequests.forEach(req => {
      const myrPayout = (parseFloat(req.payoutEth) * this.ethToMyrRate).toFixed(2);
      pendingHtml += `
        <div class="shipment-card border-warning mb-2">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fw-bold text-white fs-6">${req.title}</span>
            <span class="badge bg-warning text-dark">Pending Acceptance (18h left)</span>
          </div>
          <div class="row g-2 text-muted small mb-3">
            <div class="col-md-6">Route: <b>${req.origin}</b> ➔ <b>${req.dest}</b> (${req.distance})</div>
            <div class="col-md-6 text-md-end">Weight: <b>${req.weight}</b> | Value: <b>${req.declaredValue}</b></div>
            <div class="col-md-6">Total Escrow Freight Payout: <b class="text-success fs-6">${req.payoutEth} ETH</b> (RM ${parseFloat(myrPayout).toLocaleString()})</div>
            <div class="col-md-6 text-md-end">Required Deadline: <b>${req.deadline}</b></div>
          </div>
          <div class="d-flex justify-content-end gap-2">
            <button class="btn btn-sm btn-outline-danger px-3" onclick="App.rejectCarrierShipment(${req.id})">❌ Reject (No Penalty)</button>
            <button class="btn btn-sm btn-success px-4 fw-bold" onclick="App.acceptCarrierShipment(${req.id})">✅ Accept Freight Contract</button>
          </div>
        </div>
      `;
    });
    pendingContainer.innerHTML = pendingHtml;

    // Active Task Queue
    let activeTasks = [
      {
        id: 201,
        title: "Medical Diagnostic Equipment",
        origin: "Georgetown, Penang",
        dest: "Hospital Kuala Lumpur (HKL)",
        payoutEth: "0.0320",
        deadline: Math.floor(Date.now() / 1000) + 180 * 60,
        status: "1", // Needs pickup
        ms1: { completed: false, approved: false },
        ms2: { completed: false, approved: false }
      },
      {
        id: 202,
        title: "Frozen Seafood Refrigerated Container",
        origin: "Kuala Selangor",
        dest: "Changi Air Cargo Terminal Hub",
        payoutEth: "0.0450",
        deadline: Math.floor(Date.now() / 1000) + 720 * 60,
        status: "2", // In transit, needs delivery proof
        ms1: { completed: true, approved: true },
        ms2: { completed: false, approved: false }
      }
    ];

    const statusNames = ["PendingAcceptance", "InTransit", "Delivering", "Completed", "Refunded", "Disputed", "Cancelled"];

    if (this.carrierFilter !== "ALL") {
      activeTasks = activeTasks.filter(ag => (statusNames[parseInt(ag.status)] || "InTransit") === this.carrierFilter);
    }

    if (this.carrierSort === "valueHigh") {
      activeTasks.sort((a, b) => parseFloat(b.payoutEth) - parseFloat(a.payoutEth));
    } else {
      activeTasks.sort((a, b) => a.deadline - b.deadline);
    }

    let activeHtml = "";
    activeTasks.forEach(ag => {
      const statusIdx = parseInt(ag.status);
      const statusName = statusNames[statusIdx] || "InTransit";
      const myrVal = (parseFloat(ag.payoutEth) * this.ethToMyrRate).toFixed(2);
      const deadlineDate = new Date(parseInt(ag.deadline) * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

      let actionButtons = "";
      if (statusIdx === 1 && !ag.ms1.completed) {
        actionButtons += `<button class="btn btn-sm btn-info px-3 me-2" onclick="App.submitMilestone(${ag.id}, 0)">🚚 Submit Pickup Proof (Photo / BOL)</button>`;
      }
      if (statusIdx === 2 && ag.ms1.approved && !ag.ms2.completed) {
        actionButtons += `<button class="btn btn-sm btn-success px-3 me-2" onclick="App.submitMilestone(${ag.id}, 1)">📦 Submit Delivery Sign-off Proof</button>`;
      }

      activeHtml += `
        <div class="shipment-card">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fw-bold text-white fs-5">${ag.title}</span>
            <span class="badge badge-status-${statusName.toLowerCase()} px-3 py-1">${statusName}</span>
          </div>
          <div class="row g-2 text-muted small mb-3">
            <div class="col-md-6">Route: <b>${ag.origin}</b> ➔ <b>${ag.dest}</b></div>
            <div class="col-md-6 text-md-end">Earnable Freight Payout: <b class="text-success fs-6">${ag.payoutEth} ETH</b> (RM ${parseFloat(myrVal).toLocaleString()})</div>
            <div class="col-md-6">Milestone 1 (Pickup 30%): ${ag.ms1.approved ? '<span class="text-success fw-bold">✓ Paid</span>' : (ag.ms1.completed ? '<span class="text-warning">Pending Shipper Confirmation</span>' : '<span class="text-info fw-bold">Action Needed: Pickup Cargo</span>')}</div>
            <div class="col-md-6 text-md-end">Milestone 2 (Delivery 70%): ${ag.ms2.approved ? '<span class="text-success fw-bold">✓ Paid</span>' : (ag.ms2.completed ? '<span class="text-warning">Pending Shipper Verification</span>' : 'Pending Delivery')}</div>
            <div class="col-12 text-muted">Deadline: <b>${deadlineDate}</b></div>
          </div>
          <div class="d-flex justify-content-end">${actionButtons || '<span class="text-muted extra-small">Waiting on Shipper review</span>'}</div>
        </div>
      `;
    });

    activeContainer.innerHTML = activeHtml;
  },

  renderArbiterView: function () {
    const container = document.getElementById("arbiterDisputesList");
    if (!container) return;

    const disputes = this.allAgreements.filter(ag => parseInt(ag.status) === 5);

    if (disputes.length === 0) {
      container.innerHTML = `<div class="text-center text-muted py-5">No contested cargo claims in arbitration queue. All clear! 🕊️</div>`;
      return;
    }

    let html = "";
    disputes.forEach(ag => {
      const remainingEth = parseFloat(this.web3.utils.fromWei(ag.remainingBalance, "ether")).toFixed(3);
      html += `
        <div class="shipment-card border-warning">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h6 class="fw-bold text-warning mb-0">⚠️ Disputed Shipment #${ag.id}</h6>
            <span class="badge bg-warning text-dark">Frozen Balance: ${remainingEth} ETH</span>
          </div>
          <div class="row g-2 text-muted small mb-3">
            <div class="col-6">Shipper (Complainant): <code>${ag.shipper}</code></div>
            <div class="col-6">Carrier (Respondent): <code>${ag.carrier}</code></div>
          </div>
          <div class="p-3 bg-dark rounded border border-secondary mb-3">
            <div class="small text-white fw-semibold mb-1">Carrier Proof Hash:</div>
            <code class="text-info">${ag.ms2.ipfsProofHash || "No proof attached"}</code>
          </div>
          <div class="d-flex justify-content-end">
            <button class="btn btn-sm btn-warning fw-bold px-4" onclick="App.resolveDispute(${ag.id})">
              ⚖️ Mediate & Split Escrow
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  renderLedgerTable: function (agreementsList) {
    const tbody = document.getElementById("agreementTableBody");
    tbody.innerHTML = "";

    let list = [...agreementsList];
    if (list.length === 0) {
      list = [
        {
          id: 1,
          shipper: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          carrier: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          totalValue: this.web3.utils.toWei("0.0295", "ether"),
          deadline: Math.floor(Date.now() / 1000) + 1440 * 60,
          status: "2",
          ms1: { approved: true },
          ms2: { approved: false }
        }
      ];
    }

    const statusNames = ["PendingAcceptance", "InTransit", "Delivering", "Completed", "Refunded", "Disputed", "Cancelled", "Rejected"];

    list.forEach(ag => {
      const statusIdx = parseInt(ag.status);
      const statusName = statusNames[statusIdx] || "InTransit";
      const totalEth = parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4);
      const myrVal = (totalEth * this.ethToMyrRate).toFixed(2);
      const deadlineDate = new Date(parseInt(ag.deadline) * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

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
          <td>${deadlineDate}</td>
          <td><span class="badge badge-status-${statusName.toLowerCase()}">${statusName}</span></td>
          <td><button class="btn btn-sm btn-outline-info" onclick="App.inspectAgreement(${ag.id})">Audit Details</button></td>
        </tr>
      `;
    });
  },

  filterLedger: function () {
    const filter = document.getElementById("ledgerStatusFilter").value;
    const statusNames = ["PendingAcceptance", "InTransit", "Delivering", "Completed", "Refunded", "Disputed", "Cancelled", "Rejected"];

    if (filter === "ALL") {
      this.renderLedgerTable(this.allAgreements);
    } else {
      const filtered = this.allAgreements.filter(ag => (statusNames[parseInt(ag.status)] || "InTransit") === filter);
      this.renderLedgerTable(filtered);
    }
  },

  inspectAgreement: function (id) {
    const ag = this.allAgreements.find(a => a.id == id);
    if (!ag) return alert(`Viewing ledger verification for record #${id}`);
    alert(`Agreement #${ag.id}\nShipper: ${ag.shipper}\nCarrier: ${ag.carrier}\nRemaining Escrow: ${this.web3.utils.fromWei(ag.remainingBalance, 'ether')} ETH`);
  },

  // On-Chain Actions
  submitMilestone: async function (id, msIndex) {
    const proof = prompt("Enter IPFS Proof CID or Inspection Photo Hash:", "QmDemoBillOfLading" + Date.now());
    if (proof === null) return;
    try {
      await this.escrowContract.methods.submitMilestoneProof(id, msIndex, proof || "N/A").send({ from: this.account });
      alert("Milestone " + (msIndex + 1) + " proof successfully recorded on blockchain!");
      await this.refreshUI();
    } catch (err) {
      alert("Milestone submission failed: " + (err.message || err));
    }
  },

  approveMilestone: async function (id, msIndex) {
    const promptMsg = msIndex === 0 ? "Approve Pickup & release 30% ETH payout to Carrier?" : "Approve Final Delivery & release remaining 70% ETH payout to Carrier?";
    if (!confirm(promptMsg)) return;
    try {
      await this.escrowContract.methods.approveMilestonePayout(id, msIndex).send({ from: this.account });
      alert("Milestone payout approved & funds disbursed to Carrier wallet!");
      await this.refreshUI();
    } catch (err) {
      alert("Approval failed: " + (err.message || err));
    }
  },

  cancelAgreement: async function (id) {
    if (!confirm("Cancel Agreement #" + id + " for a 100% escrow refund?")) return;
    try {
      await this.escrowContract.methods.cancelBeforePickup(id).send({ from: this.account });
      alert("Agreement cancelled and 100% escrow refunded to your wallet!");
      await this.refreshUI();
    } catch (err) {
      alert("Cancellation failed: " + (err.message || err));
    }
  },

  raiseDispute: async function (id) {
    const reason = prompt("Enter dispute reason (e.g. Physical cargo damage, missing boxes):", "Cargo arrived damaged during transport");
    if (!reason) return;
    try {
      await this.escrowContract.methods.raiseDispute(id, reason).send({ from: this.account });
      alert("Dispute registered. Escrow frozen for Arbiter review.");
      await this.refreshUI();
    } catch (err) {
      alert("Dispute failed: " + (err.message || err));
    }
  }
};

window.addEventListener("load", () => App.init());
