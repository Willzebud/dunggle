# POC 1.2 — Qualité éditoriale, bruit et doublons

- **Collecte** : 2026-11-06T12:55:03.180Z → 2026-11-06T12:55:16.067Z ; variantes IEEE : 2026-11-06T12:56:15.298Z (rapports régénérés hors ligne depuis `candidates-raw.json`)
- **Mesuré** = issu des réponses réelles. **Estimé** = calcul ou projection à partir de ces mesures.

## Méthode

- Grille **déterministe** (`src/poc-1-2/editorial-grid.ts`) appliquée au titre et aux 200 premiers caractères de la description. Aucun LLM.
- Verdicts : **PERTINENT** (domaine Dunggle + nouveauté/analyse), **MISE_A_JOUR** (release d’un outil suivi), **AMBIGU** (à revoir humainement), **PROMO**, **FINANCE_STARTUP** (levée, acquisition, nomination, partenariat, classement), **HORS_SUJET**.
- Échantillon : jusqu’à 30 publications récentes par candidate (un seul téléchargement du flux) ; 10 par source existante (`articles.json`).
- Publications utiles / semaine (**estimé**) = volume/jour × 7 × part PERTINENT + MISE_A_JOUR.
- **Contexte de source** : pour une source mono-domaine (`SOURCE_DOMAIN_PRIOR`), une publication sans domaine détecté hérite du domaine de la source. La colonne « Utiles sans contexte de source » donne le résultat sans cette règle. **Calibration** : au premier passage, la grille sans cette règle classait l’Angular Blog à 100 % ambigu et Hugging Face à 60 % hors sujet, parce que leurs titres ne répètent pas leur domaine. La règle et quelques signaux lexicaux (update, adds, techniques, comparing…) ont été ajoutés après examen de l’échantillon.
- Limites : une grille par mots-clés ne détecte ni la qualité d’analyse ni l’opinion sans substance ; elle confond certains homonymes (« agents » chimiques, « transformers » électriques). Les proportions sont des **ordres de grandeur**.

## Sources candidates (mesuré sur échantillon, volumes estimés)

| Source | Échantillon | Utiles sans contexte de source | Pertinent | Mise à jour | Ambigu | Promo | Finance/startup | Hors sujet | Publications / semaine | Utiles / semaine | Doublons potentiels |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TypeScript Blog (Microsoft) | 10 | 90 % | 30 % | 60 % | 10 % | 0 % | 0 % | 0 % | 0.2 | **0.2** (+0 ambigus) | 0/10 |
| IEEE Spectrum | 30 | = (pas de contexte) | 23 % | 0 % | 30 % | 0 % | 13 % | 33 % | 6.3 | **1.5** (+1.9 ambigus) | 4/30 |
| Quanta Magazine | 5 | = (pas de contexte) | 20 % | 0 % | 0 % | 0 % | 0 % | 80 % | 3.9 | **0.8** (+0 ambigus) | 0/5 |
| Google Project Zero | 10 | 40 % | 50 % | 0 % | 50 % | 0 % | 0 % | 0 % | 0.2 | **0.1** (+0.1 ambigus) | 0/10 |
| MIT Technology Review | 10 | = (pas de contexte) | 30 % | 0 % | 20 % | 30 % | 0 % | 20 % | 22.6 | **6.8** (+4.5 ambigus) | 0/10 |
| The Quantum Insider | 10 | 30 % | 30 % | 0 % | 50 % | 0 % | 20 % | 0 % | 70 | **21** (+35 ambigus) | 0/10 |
| Ars Technica | 20 | = (pas de contexte) | 20 % | 0 % | 30 % | 5 % | 0 % | 45 % | 85.6 | **17.1** (+25.7 ambigus) | 0/20 |
| One Useful Thing (Ethan Mollick) | 20 | 30 % | 35 % | 0 % | 65 % | 0 % | 0 % | 0 % | 0.2 | **0.1** (+0.2 ambigus) | 0/20 |
| IEEE Spectrum — Robotics | 30 | 27 % | 37 % | 0 % | 57 % | 0 % | 7 % | 0 % | 2.3 | **0.9** (+1.3 ambigus) | 2/30 |
| IEEE Spectrum — Semiconductors | 30 | 30 % | 40 % | 0 % | 60 % | 0 % | 0 % | 0 % | 1.2 | **0.5** (+0.7 ambigus) | 2/30 |

## Référence : les 12 sources existantes (même grille)

| Source | Échantillon | Utiles sans contexte de source | Pertinent | Mise à jour | Ambigu | Promo | Finance/startup | Hors sujet | Publications / semaine | Utiles / semaine | Doublons potentiels |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Angular Blog | 10 | 30 % | 30 % | 0 % | 70 % | 0 % | 0 % | 0 % | 0.5 | **0.1** (+0.3 ambigus) | — |
| GitHub angular/angular | 10 | 100 % | 0 % | 100 % | 0 % | 0 % | 0 % | 0 % | 2.4 | **2.4** (+0 ambigus) | — |
| GitHub angular/components | 10 | 100 % | 0 % | 100 % | 0 % | 0 % | 0 % | 0 % | 2.3 | **2.3** (+0 ambigus) | — |
| OpenAI News | 10 | 30 % | 30 % | 0 % | 20 % | 30 % | 20 % | 0 % | 19.6 | **5.9** (+3.9 ambigus) | — |
| Google DeepMind Blog | 10 | 30 % | 40 % | 0 % | 60 % | 0 % | 0 % | 0 % | 2.6 | **1** (+1.5 ambigus) | — |
| Hugging Face Blog | 10 | 40 % | 70 % | 0 % | 30 % | 0 % | 0 % | 0 % | 6.5 | **4.6** (+2 ambigus) | — |
| Google Research Blog | 10 | 20 % | 30 % | 0 % | 70 % | 0 % | 0 % | 0 % | 2.3 | **0.7** (+1.6 ambigus) | — |
| Simon Willison | 10 | 30 % | 30 % | 0 % | 60 % | 10 % | 0 % | 0 % | 15.3 | **4.6** (+9.2 ambigus) | — |
| OpenAI Agents SDK (Python) | 10 | 100 % | 0 % | 100 % | 0 % | 0 % | 0 % | 0 % | 0.5 | **0.5** (+0 ambigus) | — |
| LangGraph | 10 | 100 % | 0 % | 100 % | 0 % | 0 % | 0 % | 0 % | 6.6 | **6.6** (+0 ambigus) | — |
| MCP TypeScript SDK | 10 | 100 % | 0 % | 100 % | 0 % | 0 % | 0 % | 0 % | 1.9 | **1.9** (+0 ambigus) | — |
| Claude Code | 10 | 100 % | 0 % | 100 % | 0 % | 0 % | 0 % | 0 % | 4.5 | **4.5** (+0 ambigus) | — |

## Doublons potentiels détectés (candidates vs existantes et entre candidates)

| Candidate | Publication | Doublon potentiel | Type | Score |
|---|---|---|---|---|
| IEEE Spectrum | Your Robot’s Safety Functions Already Work. What If the Input Lies? | IEEE Spectrum — Robotics : Your Robot’s Safety Functions Already Work. What If the Input Lies? | URL | 1 |
| IEEE Spectrum | From Chip Lab to Center Stage | IEEE Spectrum — Semiconductors : From Chip Lab to Center Stage | URL | 1 |
| IEEE Spectrum | The Robot I Didn’t Expect to Build | IEEE Spectrum — Robotics : The Robot I Didn’t Expect to Build | URL | 1 |
| IEEE Spectrum | Can a Radioactive Ore Break China’s Grip on Rare Earths? | IEEE Spectrum — Semiconductors : Can a Radioactive Ore Break China’s Grip on Rare Earths? | URL | 1 |
| IEEE Spectrum — Robotics | Your Robot’s Safety Functions Already Work. What If the Input Lies? | IEEE Spectrum : Your Robot’s Safety Functions Already Work. What If the Input Lies? | URL | 1 |
| IEEE Spectrum — Robotics | The Robot I Didn’t Expect to Build | IEEE Spectrum : The Robot I Didn’t Expect to Build | URL | 1 |
| IEEE Spectrum — Semiconductors | From Chip Lab to Center Stage | IEEE Spectrum : From Chip Lab to Center Stage | URL | 1 |
| IEEE Spectrum — Semiconductors | Can a Radioactive Ore Break China’s Grip on Rare Earths? | IEEE Spectrum : Can a Radioactive Ore Break China’s Grip on Rare Earths? | URL | 1 |

## Cas ambigus et exemples (pour revue humaine)

### TypeScript Blog (Microsoft)

- **PERTINENT** (3) :
  - 2026-07-08 — Announcing TypeScript 7.0 _(ANGULAR, SOFTWARE ; Domaine technologique + nouveauté/analyse)_
  - 2026-03-23 — Announcing TypeScript 6.0 _(ANGULAR, SOFTWARE ; Domaine technologique + nouveauté/analyse)_
  - 2025-08-01 — Announcing TypeScript 5.9 _(ANGULAR, SOFTWARE ; Domaine technologique + nouveauté/analyse)_
- **AMBIGU** (1) :
  - 2025-12-02 — Progress on TypeScript 7 – December 2025 _(ANGULAR, SOFTWARE ; Domaine technologique sans signal de nouveauté dans le titre)_

### IEEE Spectrum

- **PERTINENT** (7) :
  - 2026-11-05 — Why a Mathematician Is Chasing Eclipses With Algorithms and Cameras _(SOFTWARE ; Domaine technologique + nouveauté/analyse)_
  - 2026-10-27 — Your Robot’s Safety Functions Already Work. What If the Input Lies? _(ROBOTICS, FUTURE_OF_WORK ; Domaine technologique + nouveauté/analyse)_
  - 2026-10-27 — I Used AI to Fake a Scientific Paper. Here’s What Happened _(AI ; Domaine technologique + nouveauté/analyse)_
  - 2026-10-26 — IEEE Xplore Digital Library Adds AI Assistant _(AI ; Domaine technologique + nouveauté/analyse)_
- **AMBIGU** (9) :
  - 2026-11-03 — IEEE Computer Society Chapter Offers Webinars With Industry Experts _(AI ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-11-01 — Guarding the Gates of Knowledge _(AI ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-29 — Consumer Appetite for Personal AI Goes Mainstream _(AI ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-28 — Systems Thinking Is Vital in the Age of AI _(AI ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-23 — From Chip Lab to Center Stage _(HARDWARE ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-19 — Edge AI for Smart Cities: From Insight to Cognitive Action _(AI ; Domaine technologique sans signal de nouveauté dans le titre)_
- **FINANCE_STARTUP** (4) :
  - 2026-11-05 — Use Your Year-End Review to Reach for a Promotion _(FUTURE_OF_WORK ; Signal financier / corporate : « partnership »)_
  - 2026-10-22 — Why AI Can’t Replace Engineering Teams _(AI, FUTURE_OF_WORK ; Signal financier / corporate : « partnership »)_
  - 2026-10-22 — Why Engineers Should Brave Capitol Hill _(SOFTWARE, FUTURE_OF_WORK ; Signal financier / corporate : « funding »)_
  - 2026-10-17 — This Hidden Device Could Free Up Gigawatts of Grid Power _(aucun domaine ; Signal financier / corporate : « investment »)_
- **HORS_SUJET** (10) :
  - 2026-10-31 — When Electric Cars Were for Women _(aucun domaine ; Aucun domaine Dunggle détecté)_
  - 2026-10-30 — Multiphysics Modeling for Next-Generation Electromagnetic Manufacturing Technologies _(aucun domaine ; Aucun domaine Dunggle détecté)_
  - 2026-10-28 — How Beta Technologies Is Clearing the Runway for Electric Flight _(aucun domaine ; Aucun domaine Dunggle détecté)_
  - 2026-10-26 — Build a Hidden Lock With a Magnetic Imager _(aucun domaine ; Aucun domaine Dunggle détecté)_

### Quanta Magazine

- **PERTINENT** (1) :
  - 2026-11-04 — New Research Tests Whether AI Models Know Their Own Thoughts _(AI ; Domaine technologique + nouveauté/analyse)_
- **HORS_SUJET** (4) :
  - 2026-11-02 — Is There Anything Left in the Dream of Cold Fusion? _(aucun domaine ; Aucun domaine Dunggle détecté)_
  - 2026-10-30 — A New Map of ‘Empty’ Space Challenges a Tranquil Picture of the Galaxy _(aucun domaine ; Aucun domaine Dunggle détecté)_
  - 2026-10-29 — How Do You Take a Picture of a Black Hole? _(aucun domaine ; Aucun domaine Dunggle détecté)_
  - 2026-10-28 — How Spiders Spin ‘Silk Dope’ Into Nature’s Toughest Material _(aucun domaine ; Aucun domaine Dunggle détecté)_

### Google Project Zero

- **PERTINENT** (5) :
  - 2026-10-27 — Fuzzers vs. AI: Comparing Fuzzilli and BigSleep on JavaScript Engines _(AI, SECURITY, SOFTWARE ; Domaine technologique + nouveauté/analyse)_
  - 2026-10-06 — How to fix a bug in a fix _(SECURITY, SOFTWARE ; Domaine technologique + nouveauté/analyse)_
  - 2026-09-21 — Windows Exploitation Techniques: Dangling COM Object Registrations _(SECURITY ; Domaine technologique + nouveauté/analyse)_
  - 2026-09-08 — Testing race conditions with memory access tracing and stack-based delay injection _(SECURITY ; Domaine technologique + nouveauté/analyse)_
- **AMBIGU** (5) :
  - 2026-05-13 — A 0-click exploit chain for the Pixel 10: When a Door Closes, a Window Opens _(SECURITY ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-03-05 — On the Effectiveness of Mutational Grammar Fuzzing _(SECURITY ; Domaine technologique sans signal de nouveauté dans le titre (domaine hérité de la source))_
  - 2026-02-12 — Bypassing Administrator Protection by Abusing UI Access _(SECURITY ; Domaine technologique sans signal de nouveauté dans le titre (domaine hérité de la source))_
  - 2026-01-30 — Breaking the Sound Barrier, Part II: Exploiting CVE-2024-54529 _(SECURITY ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-01-26 — Bypassing Windows Administrator Protection _(SECURITY ; Domaine technologique sans signal de nouveauté dans le titre (domaine hérité de la source))_

### MIT Technology Review

- **PERTINENT** (3) :
  - 2026-11-06 — I watched a humanoid robot clean my apartment. It felt like a taste of the future. _(ROBOTICS ; Domaine technologique + nouveauté/analyse)_
  - 2026-11-04 — Texas was the new epicenter of the AI data center buildout. That might be kaput. _(AI, HARDWARE ; Domaine technologique + nouveauté/analyse)_
  - 2026-11-03 — How “reverse game theory” could keep AI agents in check _(AI, AI_AGENTS ; Domaine technologique + nouveauté/analyse)_
- **AMBIGU** (2) :
  - 2026-11-05 — A new bill could change how the US builds energy infrastructure _(REGULATION ; Sujet prospectif sans lien technologique explicite)_
  - 2026-11-04 — Securing the agentic enterprise with data lineage _(AI, AI_AGENTS ; Domaine technologique sans signal de nouveauté dans le titre)_
- **PROMO** (3) :
  - 2026-11-05 — The Download: Texas’s fragile AI boom and energy policy shifts _(AI, HARDWARE ; Signal promotionnel : « newsletter »)_
  - 2026-11-04 — The Download: blended meat, restored sight, and the agentic web _(AI_AGENTS ; Signal promotionnel : « newsletter »)_
  - 2026-11-03 — The Download: controlling AI agents and “Super Intelligence” loyalty tests _(AI, AI_AGENTS ; Signal promotionnel : « newsletter »)_
- **HORS_SUJET** (2) :
  - 2026-11-04 — Roundtables: Inside the Quest for Cognitive Immortality _(aucun domaine ; Aucun domaine Dunggle détecté)_
  - 2026-11-04 — What’s next for US energy policy after the midterm elections? _(aucun domaine ; Aucun domaine Dunggle détecté)_

### The Quantum Insider

- **PERTINENT** (3) :
  - 2026-11-06 — QNu Labs Launches Corporate Training Programme on Quantum-Safe Security _(SECURITY, QUANTUM_PHYSICS ; Domaine technologique + nouveauté/analyse)_
  - 2026-11-05 — MTSU Hosts Interstate Hackathon to Expand Quantum Computing Education _(QUANTUM_COMPUTING, FUTURE_OF_WORK ; Domaine technologique + nouveauté/analyse)_
  - 2026-11-05 — SEALSQ and Eco Wave Power Demonstrate Digital Energy Transactions for AI Data Centers _(AI, QUANTUM_COMPUTING, HARDWARE ; Domaine technologique + nouveauté/analyse)_
- **AMBIGU** (5) :
  - 2026-11-06 — UK Announces New Funding to Support Quantum Technology Commercialisation _(QUANTUM_COMPUTING ; Signal financier (« Funding ») mais innovation technique possible)_
  - 2026-11-06 — Toshiba Secures UK Contract to Develop Quantum Networking Technologies _(QUANTUM_COMPUTING ; Signal financier (« Contract ») mais innovation technique possible)_
  - 2026-11-06 — UK NQCC Partners With Phasecraft to Expand Access to Quantum Software _(QUANTUM_COMPUTING, SOFTWARE ; Signal financier (« Partners With ») mais innovation technique possible)_
  - 2026-11-06 — Guest Post — Commercial Diplomacy: Building The Quantum Ecosystem _(QUANTUM_COMPUTING ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-11-05 — IonQ Raises Revenue Forecast as Quarterly Sales Climb to $173.8 Million _(QUANTUM_COMPUTING ; Signal financier (« Raises ») mais innovation technique possible)_
- **FINANCE_STARTUP** (2) :
  - 2026-11-06 — ZeroTier Partners With Redapt to Deliver Post-Quantum Networking _(QUANTUM_COMPUTING, SOFTWARE ; Signal financier / corporate : « Partners With »)_
  - 2026-11-05 — Quantinuum Raises Revenue Outlook After Landing Its Largest Cloud Agreement _(QUANTUM_COMPUTING ; Signal financier / corporate : « Raises »)_

### Ars Technica

- **PERTINENT** (4) :
  - 2026-11-05 — NASA unveils mysterious X-70 experimental aircraft using AI-generated image _(AI ; Domaine technologique + nouveauté/analyse)_
  - 2026-11-05 — Google: Schools can keep search while skipping Gemini, but AI search is non-negotiable _(AI ; Domaine technologique + nouveauté/analyse)_
  - 2026-11-05 — Lawsuit: Man introduced his wife to ChatGPT. She used it to plan his murder. _(AI, REGULATION ; Domaine technologique + nouveauté/analyse)_
  - 2026-11-05 — Gamers go to ridiculous lengths to "improve" GTA VI with Nvidia's DLSS 5 _(HARDWARE, SOFTWARE ; Domaine technologique + nouveauté/analyse)_
- **AMBIGU** (6) :
  - 2026-11-05 — Meet *sshole, the vulnerability that lets hackers SSH into Linux devices _(SECURITY, SOFTWARE ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-11-05 — BMW bumps battery for the better: The 2027 i7 60 xDrive, driven _(HARDWARE ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-11-05 — Software squeezes more data out of Webb Telescope for imaging exoplanets _(SOFTWARE ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-11-05 — Kalshi court losses pile up as judges refuse to block state gambling laws _(REGULATION ; Sujet prospectif sans lien technologique explicite)_
  - 2026-11-05 — Agility Robotics' Nasdaq debut invites scrutiny of humanoid robot market _(ROBOTICS ; Signal financier (« stock ») mais innovation technique possible)_
  - 2026-11-04 — Nintendo's biggest ROM chip supplier is bowing out of the business _(HARDWARE ; Domaine technologique sans signal de nouveauté dans le titre)_
- **PROMO** (1) :
  - 2026-11-04 — Hackers exploited iOS and Android flaws to infect phones _(SECURITY ; Signal promotionnel : « sponsored »)_
- **HORS_SUJET** (9) :
  - 2026-11-06 — Blue Origin says it is building a higher-performing rocket engine at 1/4 the cost _(aucun domaine ; Aucun domaine Dunggle détecté)_
  - 2026-11-05 — Sony revives the original Walkman headphones, adds USB-C _(aucun domaine ; Aucun domaine Dunggle détecté)_
  - 2026-11-05 — MAHA lost bigly in the midterms—is it at death's door? _(aucun domaine ; Aucun domaine Dunggle détecté)_
  - 2026-11-05 — Statehouse wins give Democrats new power to push clean energy _(aucun domaine ; Aucun domaine Dunggle détecté)_

### One Useful Thing (Ethan Mollick)

- **PERTINENT** (7) :
  - 2026-10-20 — 30 Months on the Exponential (in Charts) _(AI, FUTURE_OF_WORK ; Domaine technologique + nouveauté/analyse (domaine hérité de la source))_
  - 2026-07-23 — An opinionated guide to which AI to use to do stuff _(AI ; Domaine technologique + nouveauté/analyse)_
  - 2026-06-09 — What it feels like to work with Mythos _(AI ; Domaine technologique + nouveauté/analyse)_
  - 2026-04-23 — Sign of the future: GPT-5.5 _(AI ; Domaine technologique + nouveauté/analyse)_
- **AMBIGU** (13) :
  - 2026-10-01 — The Dot and the Swarm _(AI, FUTURE_OF_WORK ; Domaine technologique sans signal de nouveauté dans le titre (domaine hérité de la source))_
  - 2026-09-18 — The Overhang _(AI, FUTURE_OF_WORK ; Domaine technologique sans signal de nouveauté dans le titre (domaine hérité de la source))_
  - 2026-08-31 — Agency and Agents _(AI, AI_AGENTS ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-06-30 — The twilight of the chatbots _(AI ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-06-04 — Co-Existence and the End of Co-Intelligence _(AI ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-05-26 — Choosing to Stay Human _(AI, FUTURE_OF_WORK ; Domaine technologique sans signal de nouveauté dans le titre (domaine hérité de la source))_

### IEEE Spectrum — Robotics

- **PERTINENT** (11) :
  - 2026-10-30 — Video Friday: Spot Plays to Show Its Whole-Body Manipulation _(ROBOTICS ; Domaine technologique + nouveauté/analyse)_
  - 2026-10-27 — Your Robot’s Safety Functions Already Work. What If the Input Lies? _(ROBOTICS, FUTURE_OF_WORK ; Domaine technologique + nouveauté/analyse)_
  - 2026-10-19 — The Robot I Didn’t Expect to Build _(ROBOTICS ; Domaine technologique + nouveauté/analyse)_
  - 2026-10-13 — Q&A: Mars Perseverance Rover Sets a Distance Record _(ROBOTICS ; Domaine technologique + nouveauté/analyse (domaine hérité de la source))_
- **AMBIGU** (17) :
  - 2026-11-04 — Are Drone Ports the Next Annoying Tech Neighbor? _(ROBOTICS ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-23 — Video Friday: Quadruped Robot Solves Giant Rubik’s Cube by Itself _(ROBOTICS ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-16 — Video Friday: When Two Robots Become One _(ROBOTICS ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-09 — Video Friday: Robot Decommissioning Takes a Fun Turn _(ROBOTICS ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-08 — This Disembodied Hand Is All the Robot You Need _(ROBOTICS ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-02 — Video Friday: Albatross Falls, Spins, Self-Rights, and Sails Away _(ROBOTICS ; Domaine technologique sans signal de nouveauté dans le titre)_
- **FINANCE_STARTUP** (2) :
  - 2026-09-16 — Rethinking Robot Safety in the Age of AI _(AI, ROBOTICS ; Signal financier / corporate : « raises »)_
  - 2026-08-18 — Drones With Claws Perch on Arctic Icebergs _(ROBOTICS ; Signal financier / corporate : « partnership »)_

### IEEE Spectrum — Semiconductors

- **PERTINENT** (12) :
  - 2026-10-15 — Can a Radioactive Ore Break China’s Grip on Rare Earths? _(HARDWARE ; Domaine technologique + nouveauté/analyse (domaine hérité de la source))_
  - 2026-09-29 — Unveiling IC-STAR: Full-Flow Autonomy from Digital to Analog _(AI ; Domaine technologique + nouveauté/analyse)_
  - 2026-09-14 — How OpenAI Used Its Own LLMs to Design Its Jalapeño Chip _(AI, HARDWARE ; Domaine technologique + nouveauté/analyse)_
  - 2026-08-26 — China’s Grip on Erbium and Yttrium Could Choke Data-Center Growth _(HARDWARE ; Domaine technologique + nouveauté/analyse (domaine hérité de la source))_
- **AMBIGU** (18) :
  - 2026-10-23 — From Chip Lab to Center Stage _(HARDWARE ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-20 — Community Colleges Put New Workers Into Semiconductor Jobs Fast _(HARDWARE, FUTURE_OF_WORK ; Signal financier (« investments ») mais innovation technique possible)_
  - 2026-10-13 — U.S. Chip Firms Bet Big on R&D _(HARDWARE ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-07 — The U.S. Just Bet $1 Billion on Quantum Chip Manufacturing _(QUANTUM_COMPUTING, HARDWARE ; Domaine technologique sans signal de nouveauté dans le titre)_
  - 2026-10-02 — Engineering Multipole Resonances in Dielectric Metasurfaces for Transmission, Reflection, and Absorption Control _(HARDWARE ; Domaine technologique sans signal de nouveauté dans le titre (domaine hérité de la source))_
  - 2026-09-23 — EU Tech Push Boosts Ultrafast Laser Startups _(HARDWARE, REGULATION ; Domaine technologique sans signal de nouveauté dans le titre)_
