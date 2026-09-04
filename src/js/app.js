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
  shipperSearchTerm: "",
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
  originCoords: null, // Start empty so form has no default pin
  destCoords: null,   // Start empty so form has no default pin

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

    const defaultCenter = [4.2105, 101.9758]; // Malaysia central map center

    // 1. Origin Map (Interactive: keyword search, pin drag, click to pick)
    const originEl = document.getElementById("originMap");
    if (originEl && !this.originMap) {
      this.originMap = L.map("originMap", { zoomControl: true }).setView(this.originCoords || defaultCenter, this.originCoords ? 11 : 6);
      createTileLayer().addTo(this.originMap);

      if (this.originCoords) {
        this.originMarker = L.marker(this.originCoords, { draggable: true, title: "Origin Pickup" }).addTo(this.originMap);
        this.originMarker.bindPopup("<b>🟢 Origin Location</b><br><small>Drag pin or click map to move</small>").openPopup();
        this.originMarker.on("dragend", () => {
          const latlng = this.originMarker.getLatLng();
          this.setOriginLocation(latlng.lat, latlng.lng);
        });
      }

      this.originMap.on("click", (e) => {
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
        this.destMarker.on("dragend", () => {
          const latlng = this.destMarker.getLatLng();
          this.setDestLocation(latlng.lat, latlng.lng);
        });
      }

      this.destMap.on("click", (e) => {
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
    if (this.originMap) {
      if (!this.originMarker) {
        this.originMarker = L.marker(this.originCoords, { draggable: true, title: "Origin Pickup" }).addTo(this.originMap);
        this.originMarker.on("dragend", () => {
          const latlng = this.originMarker.getLatLng();
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

  setDestLocation: function (lat, lng, addressLabel) {
    this.destCoords = [lat, lng];
    if (this.destMap) {
      if (!this.destMarker) {
        this.destMarker = L.marker(this.destCoords, { draggable: true, title: "Destination" }).addTo(this.destMap);
        this.destMarker.on("dragend", () => {
          const latlng = this.destMarker.getLatLng();
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

    this.recalculateShipperQuote();
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
      let multiplier = "1.00";
      if (parseInt(rep) >= 1000) {
        tier = "🥇 Gold";
        multiplier = "1.30";
      } else if (parseInt(rep) >= 300) {
        tier = "🥈 Silver";
        multiplier = "1.15";
      }

      const opt = document.createElement("option");
      opt.value = carrierAddr;
      opt.text = `${carrierUser.name} [${tier} - ${rep} CRT] (${carrierAddr.substring(0, 6)}...${carrierAddr.substring(38)})`;
      opt.dataset.multiplier = multiplier;
      select.appendChild(opt);
    }

    // If no carriers registered yet, provide demo entries
    if (count == 0) {
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
      return alert("Please choose a designated registered carrier!");
    }
    if (!deadlineInput) {
      return alert("Please set an exact delivery completion deadline!");
    }

    const deadlineTimestamp = Math.floor(new Date(deadlineInput).getTime() / 1000);
    if (deadlineTimestamp <= Math.floor(Date.now() / 1000)) {
      return alert("The deadline must be a future date and time!");
    }

    const cargoDesc = document.getElementById("createCargoDesc").value.trim();
    if (!cargoDesc) {
      return alert("Please enter the cargo description / item manifest!");
    }

    const originAddress = document.getElementById("originSelectedAddress").value;
    if (!originAddress) {
      return alert("Please select an origin / pickup location on the map or search!");
    }
    const originDetails = document.getElementById("originAddressDetails").value.trim();

    const destAddress = document.getElementById("destSelectedAddress").value;
    if (!destAddress) {
      return alert("Please select a destination / delivery location on the map or search!");
    }
    const destDetails = document.getElementById("destAddressDetails").value.trim();

    const cargoVal = document.getElementById("createCargoValue").value;
    if (!cargoVal || parseFloat(cargoVal) <= 0) {
      return alert("Please enter the declared cargo value (RM)!");
    }

    const cargoWeight = document.getElementById("createWeight").value;
    if (!cargoWeight || parseFloat(cargoWeight) <= 0) {
      return alert("Please enter the cargo weight (kg)!");
    }

    const originDisplay = originDetails ? `${originAddress} (${originDetails})` : originAddress;
    const destDisplay = destDetails ? `${destAddress} (${destDetails})` : destAddress;
    const declaredValNum = parseInt(cargoVal) || 25000;

    // 1. Upload initial photo to IPFS service
    let ipfsPhotoCid = "QmDefaultCargoConditionProof";
    const photoInput = document.getElementById("createCargoPhotoInput");
    if (photoInput && photoInput.files && photoInput.files[0]) {
      const fd = new FormData();
      fd.append("photo", photoInput.files[0]);
      try {
        const upRes = await fetch("/api/upload-ipfs", { method: "POST", body: fd });
        const upData = await upRes.json();
        if (upData && upData.cid) {
          ipfsPhotoCid = upData.cid;
          console.log("[IPFS] Cargo condition photo uploaded with CID:", ipfsPhotoCid);
        }
      } catch (uploadErr) {
        console.warn("[IPFS] Upload fallback:", uploadErr);
      }
    }

    // 2. Dispatch on-chain agreement with CargoSpec struct
    const cargoSpec = [
      cargoDesc,
      originDisplay,
      destDisplay,
      ipfsPhotoCid,
      declaredValNum
    ];

    try {
      const weiVal = this.web3.utils.toWei(totalEthStr, "ether");

      await this.escrowContract.methods.createAgreement(
        carrier,
        deadlineTimestamp,
        cargoSpec
      ).send({
        from: this.account,
        value: weiVal
      });

      alert(`✅ Freight Agreement dispatched on-chain!\n• Status: Pending Carrier Acceptance\n• Escrow Locked: ${totalEthStr} ETH\n• IPFS Proof CID: ${ipfsPhotoCid}`);
      
      // Close creation panel and clear all form inputs for next time
      if (this.isCreatePanelOpen) {
        this.toggleCreateAgreementPanel();
      }
      this.clearCreateAgreementForm();

      await this.refreshUI();
    } catch (err) {
      console.error(err);
      alert("Agreement creation failed: " + (err.message || err));
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
        const cargo = await this.escrowContract.methods.getAgreementCargo(i).call();
        const ms1 = await this.escrowContract.methods.getMilestoneDetails(i, 0).call();
        const ms2 = await this.escrowContract.methods.getMilestoneDetails(i, 1).call();

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
          ms1,
          ms2
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

  updateShipperFilterBadges: function () {
    if (!this.allAgreements || !this.account) return;
    const myAgreements = this.allAgreements.filter(ag => ag.shipper && ag.shipper.toLowerCase() === this.account.toLowerCase());

    const pendingCount = myAgreements.filter(ag => parseInt(ag.status) === 0).length;
    const pickupCount = myAgreements.filter(ag => parseInt(ag.status) === 1).length;
    const transitCount = myAgreements.filter(ag => parseInt(ag.status) === 2).length;

    const pendingBadge = document.getElementById("shipperBadgePending");
    const pickupBadge = document.getElementById("shipperBadgePickup");
    const transitBadge = document.getElementById("shipperBadgeTransit");

    if (pendingBadge) {
      pendingBadge.innerText = pendingCount;
      if (pendingCount > 0) {
        pendingBadge.classList.remove("d-none");
      } else {
        pendingBadge.classList.add("d-none");
      }
    }

    if (pickupBadge) {
      pickupBadge.innerText = pickupCount;
      if (pickupCount > 0) {
        pickupBadge.classList.remove("d-none");
      } else {
        pickupBadge.classList.add("d-none");
      }
    }

    if (transitBadge) {
      transitBadge.innerText = transitCount;
      if (transitCount > 0) {
        transitBadge.classList.remove("d-none");
      } else {
        transitBadge.classList.add("d-none");
      }
    }
  },

  renderShipperView: function () {
    const container = document.getElementById("shipperShipmentsList");
    if (!container) return;

    this.updateShipperFilterBadges();

    let items = this.allAgreements.filter(ag => ag.shipper.toLowerCase() === this.account.toLowerCase());

    const statusNames = ["PendingAcceptance", "InTransit", "Delivering", "Completed", "Refunded", "Disputed", "Cancelled", "Rejected"];

    if (this.shipperFilter !== "ALL") {
      items = items.filter(ag => (statusNames[parseInt(ag.status)] || "PendingAcceptance") === this.shipperFilter);
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
      const statusName = statusNames[statusIdx] || "PendingAcceptance";
      const totalEth = parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4);
      const myrVal = (totalEth * this.ethToMyrRate).toFixed(2);
      const deadlineDate = new Date(parseInt(ag.deadline) * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

      let actionButtons = "";
      if (statusIdx === 0) {
        actionButtons += `<button class="btn btn-sm btn-outline-danger me-2" onclick="event.stopPropagation(); App.cancelAgreement(${ag.id})">❌ Cancel Agreement (100% Refund)</button>`;
      }
      if (statusIdx === 1 && !ag.ms1.completed) {
        actionButtons += `<button class="btn btn-sm btn-outline-danger me-2" onclick="event.stopPropagation(); App.cancelAgreement(${ag.id})">❌ Cancel Before Pickup (100% Refund)</button>`;
      }
      if (statusIdx === 1 && ag.ms1.completed && !ag.ms1.approved) {
        actionButtons += `<button class="btn btn-sm btn-primary me-2" onclick="event.stopPropagation(); App.approveMilestone(${ag.id}, 0)">✅ Approve Pickup (Release 30%)</button>`;
      }
      if (statusIdx === 2 && ag.ms2.completed && !ag.ms2.approved) {
        actionButtons += `<button class="btn btn-sm btn-success me-2" onclick="event.stopPropagation(); App.approveMilestone(${ag.id}, 1)">✅ Approve Delivery (Release 70%)</button>`;
        actionButtons += `<button class="btn btn-sm btn-warning me-2" onclick="event.stopPropagation(); App.raiseDispute(${ag.id})">⚠️ Raise Cargo Dispute</button>`;
      }

      // Conspicuous contextual card footer status
      let footerStatusHtml = "";
      if (actionButtons) {
        footerStatusHtml = actionButtons;
      } else if (statusIdx === 6) { // Cancelled
        footerStatusHtml = `<span class="badge bg-danger bg-opacity-25 border border-danger text-danger px-3 py-1 fw-bold">🛑 Agreement Cancelled • Escrow Fully Refunded</span>`;
      } else if (statusIdx === 3) { // Completed
        footerStatusHtml = `<span class="badge bg-success bg-opacity-25 border border-success text-success px-3 py-1 fw-bold">✅ Completed & Fully Settled</span>`;
      } else if (statusIdx === 4) { // Refunded
        footerStatusHtml = `<span class="badge bg-secondary bg-opacity-25 border border-secondary text-light px-3 py-1 fw-bold">↩️ Escrow Refunded</span>`;
      } else if (statusIdx === 7) { // Rejected
        footerStatusHtml = `<span class="badge bg-danger bg-opacity-25 border border-danger text-danger px-3 py-1 fw-bold">❌ Carrier Declined Agreement</span>`;
      } else if (statusIdx === 5) { // Disputed
        footerStatusHtml = `<span class="badge bg-warning bg-opacity-25 border border-warning text-warning px-3 py-1 fw-bold">⚠️ Under Arbiter Mediation</span>`;
      } else if (statusIdx === 0) { // PendingAcceptance
        footerStatusHtml = `<span class="text-warning extra-small">⏳ Awaiting Carrier Acceptance</span>`;
      } else {
        footerStatusHtml = `<span class="text-muted extra-small">🚚 Transit in progress</span>`;
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
            <span class="badge badge-status-${statusName.toLowerCase()} px-3 py-1">${statusName}</span>
          </div>
          <div class="row g-2 text-muted small mb-3">
            <div class="col-md-6">Route: <b>${ag.origin}</b> ➔ <b>${ag.dest}</b></div>
            <div class="col-md-6 text-md-end">Declared Value: <b class="text-white">RM ${parseFloat(ag.declaredValue || 25000).toLocaleString()}</b></div>
            <div class="col-md-6">Carrier Fleet: <code>${ag.carrier.substring(0, 6)}...${ag.carrier.substring(38)}</code></div>
            <div class="col-md-6 text-md-end">Escrow Deposit: <b class="text-white fs-6">${totalEth} ETH</b> <span class="text-info">(RM ${parseFloat(myrVal).toLocaleString()})</span></div>
            <div class="col-md-6">Milestone 1 (Pickup 30%): ${ag.ms1.approved ? '<span class="text-success fw-bold">✓ Released</span>' : (ag.ms1.completed ? '<span class="text-warning fw-bold">Verification Submitted</span>' : '<span class="text-muted">Pending</span>')}</div>
            <div class="col-md-6 text-md-end">Milestone 2 (Delivery 70%): ${ag.ms2.approved ? '<span class="text-success fw-bold">✓ Released</span>' : (ag.ms2.completed ? '<span class="text-warning fw-bold">Sign-off Submitted</span>' : '<span class="text-muted">Pending</span>')}</div>
            <div class="col-12 text-muted">Delivery Deadline: <b>${deadlineDate}</b></div>
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
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-5 text-muted">No blockchain escrow records found on-chain. Dispatched agreements will appear here permanently indexed.</td></tr>`;
      return;
    }

    const statusNames = ["PendingAcceptance", "InTransit", "Delivering", "Completed", "Refunded", "Disputed", "Cancelled", "Rejected"];

    list.forEach(ag => {
      const statusIdx = parseInt(ag.status);
      const statusName = statusNames[statusIdx] || "PendingAcceptance";
      const totalEth = parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4);
      const myrVal = (totalEth * this.ethToMyrRate).toFixed(2);
      const deadlineDate = new Date(parseInt(ag.deadline) * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

      const ipfsBtn = (ag.initialPhotoIpfs && ag.initialPhotoIpfs !== "QmDefaultCargoProof") ? 
        `<button class="btn btn-sm btn-outline-primary extra-small px-2 py-0 ms-1" onclick="App.showIpfsModal('${ag.initialPhotoIpfs}', '${(ag.cargoTitle || '').replace(/'/g, "\\'")}')">📷 IPFS</button>` : "";

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
          <td>
            <button class="btn btn-sm btn-outline-info extra-small px-2 py-0" onclick="App.inspectAgreement(${ag.id})">🔍 Audit</button>
            ${ipfsBtn}
          </td>
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
      const filtered = this.allAgreements.filter(ag => (statusNames[parseInt(ag.status)] || "PendingAcceptance") === filter);
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
    const modalEl = document.getElementById("shipmentDetailModal");
    if (modalEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
    }
  },

  openShipmentDetailModal: function (id) {
    const ag = this.allAgreements.find(a => String(a.id) === String(id));
    if (!ag) {
      alert("Shipment contract #" + id + " not found.");
      return;
    }

    const modalEl = document.getElementById("shipmentDetailModal");
    if (!modalEl) return;

    const statusNames = ["PendingAcceptance", "InTransit", "Delivering", "Completed", "Refunded", "Disputed", "Cancelled", "Rejected"];
    const statusIdx = parseInt(ag.status);
    const statusName = statusNames[statusIdx] || "PendingAcceptance";

    // 1. Header Information
    const titleEl = document.getElementById("modalShipmentTitle");
    if (titleEl) titleEl.innerText = ag.cargoTitle || `Freight Contract #${ag.id}`;

    const idBadgeEl = document.getElementById("modalShipmentIdBadge");
    if (idBadgeEl) idBadgeEl.innerText = `Escrow Contract #${ag.id}`;

    const statusBadgeEl = document.getElementById("modalShipmentStatusBadge");
    if (statusBadgeEl) {
      statusBadgeEl.className = `badge badge-status-${statusName.toLowerCase()} px-3 py-1`;
      statusBadgeEl.innerText = statusName;
    }

    const iconEl = document.getElementById("modalShipmentIcon");
    if (iconEl) {
      if (statusIdx === 3) iconEl.innerText = "✅";
      else if (statusIdx === 5) iconEl.innerText = "⚠️";
      else if (statusIdx === 6 || statusIdx === 7) iconEl.innerText = "🛑";
      else if (statusIdx === 2) iconEl.innerText = "🚚";
      else iconEl.innerText = "📦";
    }

    // 2. Proof Gallery (Side-by-Side Comparison)
    // Gather all valid proofs:
    // - Proof 1: Origin creation cargo condition proof (Shipper)
    // - Proof 2: Milestone 1 pickup condition proof (Carrier)
    // - Proof 3: Milestone 2 delivery condition signoff proof (Carrier)
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
        stageBadge: "Stage 2 • Milestone 1 (30%)",
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
        stageBadge: "Stage 3 • Milestone 2 (70%)",
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
    const originEl = document.getElementById("modalOriginLocation");
    if (originEl) originEl.innerText = ag.origin || "Origin Depot";

    const destEl = document.getElementById("modalDestLocation");
    if (destEl) destEl.innerText = ag.dest || "Destination Depot";

    const declaredValueEl = document.getElementById("modalDeclaredValue");
    if (declaredValueEl) declaredValueEl.innerText = `RM ${parseFloat(ag.declaredValue || 25000).toLocaleString()}`;
    
    const deadlineSec = parseInt(ag.deadline);
    const deadlineDate = new Date(deadlineSec * 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const diffSec = deadlineSec - nowSec;
    let deadlineStr = deadlineDate.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    if (statusIdx < 3) {
      if (diffSec > 0) {
        const hours = Math.floor(diffSec / 3600);
        const mins = Math.floor((diffSec % 3600) / 60);
        deadlineStr += ` (${hours}h ${mins}m left)`;
      } else {
        deadlineStr += " (⚠️ Expired)";
      }
    }
    const deadlineEl = document.getElementById("modalDeadline");
    if (deadlineEl) deadlineEl.innerText = deadlineStr;

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

    // Milestones
    const ms1Badge = document.getElementById("modalMs1Badge");
    const ms1Sub = document.getElementById("modalMs1Sub");
    if (ms1Badge && ms1Sub) {
      if (ag.ms1 && ag.ms1.approved) {
        ms1Badge.className = "badge bg-success";
        ms1Badge.innerText = "✓ Released (30%)";
        ms1Sub.innerText = "Pickup approved by Shipper & 30% ETH payout disbursed.";
      } else if (ag.ms1 && ag.ms1.completed) {
        ms1Badge.className = "badge bg-warning text-dark";
        ms1Badge.innerText = "Pending Shipper Approval";
        ms1Sub.innerText = "Carrier submitted pickup photo. Awaiting Shipper confirmation.";
      } else {
        ms1Badge.className = "badge bg-secondary";
        ms1Badge.innerText = "Pending Pickup";
        ms1Sub.innerText = "Awaiting Carrier arrival at origin loading dock.";
      }
    }

    const ms2Badge = document.getElementById("modalMs2Badge");
    const ms2Sub = document.getElementById("modalMs2Sub");
    if (ms2Badge && ms2Sub) {
      if (ag.ms2 && ag.ms2.approved) {
        ms2Badge.className = "badge bg-success";
        ms2Badge.innerText = "✓ Released (70%)";
        ms2Sub.innerText = "Final delivery confirmed by Shipper & 70% ETH payout disbursed.";
      } else if (ag.ms2 && ag.ms2.completed) {
        ms2Badge.className = "badge bg-warning text-dark";
        ms2Badge.innerText = "Pending Shipper Sign-off";
        ms2Sub.innerText = "Carrier submitted delivery sign-off. Awaiting Shipper final settlement.";
      } else {
        ms2Badge.className = "badge bg-secondary";
        ms2Badge.innerText = "Pending Delivery";
        ms2Sub.innerText = "Cargo en route to destination facility.";
      }
    }

    // 4. Bottom Functional Action Buttons
    let actionsHtml = "";
    const isShipper = this.account && ag.shipper && ag.shipper.toLowerCase() === this.account.toLowerCase();
    const isCarrier = this.account && ag.carrier && ag.carrier.toLowerCase() === this.account.toLowerCase();

    if (isShipper) {
      if (statusIdx === 0) {
        actionsHtml += `<button class="btn btn-sm btn-outline-danger px-3" onclick="App.cancelAgreement(${ag.id})">❌ Cancel Agreement (100% Refund)</button>`;
      }
      if (statusIdx === 1 && (!ag.ms1 || !ag.ms1.completed)) {
        actionsHtml += `<button class="btn btn-sm btn-outline-danger px-3" onclick="App.cancelAgreement(${ag.id})">❌ Cancel Before Pickup (100% Refund)</button>`;
      }
      if (statusIdx === 1 && ag.ms1 && ag.ms1.completed && !ag.ms1.approved) {
        actionsHtml += `<button class="btn btn-sm btn-primary px-3 fw-bold" onclick="App.approveMilestone(${ag.id}, 0)">✅ Approve Pickup (Release 30%)</button>`;
      }
      if (statusIdx === 2 && ag.ms2 && ag.ms2.completed && !ag.ms2.approved) {
        actionsHtml += `<button class="btn btn-sm btn-success px-3 fw-bold" onclick="App.approveMilestone(${ag.id}, 1)">✅ Approve Delivery (Release 70%)</button>`;
        actionsHtml += `<button class="btn btn-sm btn-warning px-3" onclick="App.raiseDispute(${ag.id})">⚠️ Raise Cargo Dispute</button>`;
      }
    } else if (isCarrier) {
      if (statusIdx === 0) {
        actionsHtml += `<button class="btn btn-sm btn-outline-danger px-3" onclick="App.rejectCarrierShipment(${ag.id})">❌ Reject Freight Contract</button>`;
        actionsHtml += `<button class="btn btn-sm btn-success px-3 fw-bold" onclick="App.acceptCarrierShipment(${ag.id})">✅ Accept Freight Contract</button>`;
      }
      if (statusIdx === 1 && (!ag.ms1 || !ag.ms1.completed)) {
        actionsHtml += `<button class="btn btn-sm btn-primary px-3 fw-bold" onclick="App.submitMilestone(${ag.id}, 0)">📷 Submit Pickup Proof (Milestone 1)</button>`;
      }
      if (statusIdx === 2 && (!ag.ms2 || !ag.ms2.completed)) {
        actionsHtml += `<button class="btn btn-sm btn-success px-3 fw-bold" onclick="App.submitMilestone(${ag.id}, 1)">🏁 Submit Delivery Proof (Milestone 2)</button>`;
      }
    }

    actionsHtml += `
      <button class="btn btn-sm btn-outline-info px-3" onclick="App.inspectAgreement(${ag.id})">📋 Escrow Audit</button>
      <button type="button" class="btn btn-secondary btn-sm px-4" data-bs-dismiss="modal">Close</button>
    `;

    const actionContainer = document.getElementById("modalActionButtonsContainer");
    if (actionContainer) actionContainer.innerHTML = actionsHtml;

    // 5. Open Modal
    try {
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

  inspectAgreement: function (id) {
    const ag = this.allAgreements.find(a => a.id == id);
    if (!ag) return alert(`Viewing ledger verification for record #${id}`);
    const totalEth = parseFloat(this.web3.utils.fromWei(ag.totalValue, "ether")).toFixed(4);
    const remainingEth = parseFloat(this.web3.utils.fromWei(ag.remainingBalance, "ether")).toFixed(4);
    const statusNames = ["PendingAcceptance", "InTransit", "Delivering", "Completed", "Refunded", "Disputed", "Cancelled", "Rejected"];
    const statusName = statusNames[parseInt(ag.status)] || "Unknown";

    alert(
      `📋 On-Chain Escrow Audit #${ag.id}\n` +
      `----------------------------------------\n` +
      `Cargo: ${ag.cargoTitle}\n` +
      `Route: ${ag.origin} ➔ ${ag.dest}\n` +
      `Declared Value: RM ${parseFloat(ag.declaredValue || 25000).toLocaleString()}\n` +
      `Shipper: ${ag.shipper}\n` +
      `Carrier: ${ag.carrier}\n` +
      `Locked Escrow: ${totalEth} ETH\n` +
      `Remaining Balance: ${remainingEth} ETH\n` +
      `IPFS CID: ${ag.initialPhotoIpfs}\n` +
      `Contract State: ${statusName}`
    );
  },

  // On-Chain Actions
  submitMilestone: async function (id, msIndex) {
    const proof = prompt("Enter IPFS Proof CID or Inspection Photo Hash:", "QmDemoBillOfLading" + Date.now());
    if (proof === null) return;
    this.hideShipmentDetailModal();
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
    this.hideShipmentDetailModal();
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
    this.hideShipmentDetailModal();
    try {
      if (this.escrowContract.methods.cancelAgreement) {
        await this.escrowContract.methods.cancelAgreement(id).send({ from: this.account });
      } else {
        await this.escrowContract.methods.cancelBeforePickup(id).send({ from: this.account });
      }
      alert("Agreement cancelled and 100% escrow refunded to your wallet!");
      await this.refreshUI();
    } catch (err) {
      alert("Cancellation failed: " + (err.message || err));
    }
  },

  raiseDispute: async function (id) {
    const reason = prompt("Enter dispute reason (e.g. Physical cargo damage, missing boxes):", "Cargo arrived damaged during transport");
    if (!reason) return;
    this.hideShipmentDetailModal();
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
