/**
 * POC 1.2 — Grille éditoriale DÉTERMINISTE (aucun LLM).
 * Appliquée au titre + aux 200 premiers caractères de la description.
 *
 * Verdicts :
 *  PERTINENT       domaine technologique Dunggle + signal de nouveauté ou d'analyse
 *  MISE_A_JOUR     release / version d'un outil suivi (rubrique « Mises à jour »)
 *  AMBIGU          à revoir humainement (domaine sans nouveauté, prospective sans lien technique clair,
 *                  rumeur, ou exclusion + innovation possible)
 *  PROMO           contenu promotionnel / témoignage client / newsletter
 *  FINANCE_STARTUP levée de fonds, valorisation, acquisition, nomination, classement, bourse
 *  HORS_SUJET      aucun domaine Dunggle détecté
 *
 * Contexte de source (règle documentée) : pour une source MONO-DOMAINE (SOURCE_DOMAIN_PRIOR), une publication
 * sans domaine détecté hérite du domaine de la source. Sans cette règle, les sources spécialisées, dont les titres
 * ne répètent pas leur domaine (« Signal Value Transforms… », « Testing race conditions… »), sont sous-évaluées.
 * Les rapports affichent les résultats avec ET sans cette règle.
 *
 * ⚠️ Grille volontairement simple : elle sert à estimer des proportions, pas à décider publication par publication.
 */
export type Verdict = 'PERTINENT' | 'MISE_A_JOUR' | 'AMBIGU' | 'PROMO' | 'FINANCE_STARTUP' | 'HORS_SUJET';

export const TECH_DOMAINS: Record<string, RegExp> = {
  ANGULAR: /\b(angular|typescript|rxjs|zone\.?js|ecmascript|tc39)\b/i,
  AI: /\b(ai|a\.i\.|artificial intelligence|llms?|large language models?|gpt[-‑ ]?\d[\w.]*|chatgpt|gemini|claude|machine learning|deep learning|neural net\w*|generative|diffusion models?|multimodal|foundation models?|openai|anthropic|deepmind|hugging ?face|chatbots?|reasoning models?|language models?)\b/i,
  AI_AGENTS: /\b(agents?|agentic|mcp|model context protocol|copilot|codex|claude code|coding (assistants?|agents?)|vibe[- ]coding|ai coding|orchestrat\w+)\b/i,
  QUANTUM_COMPUTING: /\b(qubits?|quantum (comput\w*|processors?|chips?|advantage|supremacy|error|algorithms?|networks?|sensing|internet|hardware|software|machines?|devices?)|post-quantum|logical qubits?)\b/i,
  ROBOTICS: /\b(robot\w*|humanoids?|drones?|self-driving|autonomous (vehicles?|cars?|driving|systems?)|exoskeletons?|robotaxi\w*)\b/i,
  SECURITY: /\b(vulnerabilit(y|ies)|exploit\w*|cve-\d+|zero[- ]days?|0-days?|malware|ransomware|cyber ?security|cyber ?attacks?|hack(ers?|ed|ing)|encryption|cryptograph\w*|phishing|botnets?|security (flaw|bug|research|patch)\w*|sandbox|memory safety|spyware)\b/i,
  HARDWARE: /\b(chips?|semiconductors?|gpus?|tpus?|cpus?|processors?|transistors?|photonic\w*|data ?cent(er|re)s?|batter(y|ies)|nvidia|tsmc|risc-v|neuromorphic|lithography|supercomputers?)\b/i,
  SOFTWARE: /\b(compilers?|programming languages?|javascript|rust|webassembly|wasm|databases?|kernel|linux|open[- ]source|runtimes?|algorithms?|software)\b/i,
};

export const PROSPECTIVE_DOMAINS: Record<string, RegExp> = {
  FUTURE_OF_WORK: /\b(jobs?|workers?|workforce|workplace|employ\w*|labou?r|productivity|skills?|careers?|hiring|education|students?|teachers?|economy|economic)\b/i,
  REGULATION: /\b(regulat\w+|ai act|legislation|lawmakers?|copyright|antitrust|ftc|fcc|european commission|congress|senate|lawsuits?|sued|court)\b/i,
  /** « quantum » sans contexte informatique : physique fondamentale, lien numérique incertain */
  QUANTUM_PHYSICS: /\bquantum\b/i,
};

const FINANCE = /\b(raises?|raised|raising|funding|series [a-f]\b|seed (round|funding)|valuation|valued at|unicorns?|investors?|investments?|ipo|spac|earnings|revenue|quarterly|stocks?|market cap|acquires?|acquisition|acquired|to acquire|mergers?|appoints?|appointed|names? (new )?(ceo|cto|cfo|president|chief)|steps? down|board of directors|top \d+|startups? to watch|partnership|partners with|contract|grant)\b/i;
const PROMO = /\b(sponsored|webinar|register now|discount|deals?:|% off|giveaway|black friday|partner content|newsletter|sponsors?|subscribe|uses (openai|chatgpt|codex|claude|gemini)|builds .* with (openai|codex|chatgpt|claude)|grows .* with|case study|customer stor\w+)\b/i;
const NOVELTY = /\b(new|introduc\w*|launch\w*|announc\w*|releas\w*|unveil\w*|debut\w*|first|breakthrough|record|demonstrat\w*|discover\w*|achiev\w*|now available|available now|open[- ]sourc\w*|beta|preview|rc|v?\d+\.\d+|faster|outperform\w*|state[- ]of[- ]the[- ]art|benchmarks?|invent\w*|builds?|creat\w+|develop\w*|updates?|upgrad\w*|adds?|join(s)?|expands?|improv\w*|enabl\w*)\b/i;
const ANALYSIS = /\b(how|why|what|inside|explain\w*|analysis|deep dive|lessons|study|studies|research\w*|paper|finds?|shows?|reveals?|future|guide|could|will|can|techniques?|testing|compar\w+|vs\.?|lessons?|in charts)\b/i;
const RUMOR = /\b(rumou?rs?|reportedly|leak(ed|s)?|may soon|is said to)\b/i;
const RELEASE = /^(announcing |typescript )?v?\d+\.\d+|\b(release candidate|rc\d*|beta|patch release)\b/i;

/** Domaine(s) hérité(s) par les sources mono-domaine. Les médias généralistes n'en ont pas. */
export const SOURCE_DOMAIN_PRIOR: Record<string, string[]> = {
  'angular-blog': ['ANGULAR'],
  'gh-angular': ['ANGULAR'],
  'gh-angular-components': ['ANGULAR'],
  'gh-openai-agents': ['AI_AGENTS'],
  'gh-langgraph': ['AI_AGENTS'],
  'gh-mcp-ts-sdk': ['AI_AGENTS'],
  'gh-claude-code': ['AI_AGENTS'],
  'ieee-robotics': ['ROBOTICS'],
  'ieee-semiconductors': ['HARDWARE'],
  'typescript-blog': ['ANGULAR'],
  'huggingface-blog': ['AI'],
  'openai-news': ['AI'],
  'deepmind-blog': ['AI'],
  'google-research': ['AI'],
  'simon-willison': ['AI'],
  'project-zero': ['SECURITY'],
  'quantum-insider': ['QUANTUM_COMPUTING'],
  'one-useful-thing': ['AI', 'FUTURE_OF_WORK'],
};

export interface GridResult {
  verdict: Verdict;
  domains: string[];
  signals: string[];
  note: string;
}

export function gradePublication(title: string, description: string | null, opts: { releaseSource?: boolean; sourceDomains?: string[] } = {}): GridResult {
  const text = `${title} ${(description ?? '').slice(0, 200)}`;
  let tech = Object.entries(TECH_DOMAINS).filter(([, re]) => re.test(text)).map(([k]) => k);
  const inherited = tech.length === 0 && !!opts.sourceDomains?.length;
  if (inherited) tech = opts.sourceDomains!.filter((d) => d in TECH_DOMAINS);
  const prosp = Object.entries(PROSPECTIVE_DOMAINS).filter(([, re]) => re.test(text)).map(([k]) => k);
  const domains = [...tech, ...prosp.filter((p) => !(p === 'QUANTUM_PHYSICS' && tech.includes('QUANTUM_COMPUTING')))];
  const signals: string[] = [];
  const fin = text.match(FINANCE)?.[0];
  const promo = text.match(PROMO)?.[0];
  const novelty = NOVELTY.test(title);
  const analysis = ANALYSIS.test(title);
  const rumor = text.match(RUMOR)?.[0];
  if (fin) signals.push(`finance:${fin}`);
  if (promo) signals.push(`promo:${promo}`);
  if (novelty) signals.push('nouveauté');
  if (analysis) signals.push('analyse');
  if (rumor) signals.push(`rumeur:${rumor}`);
  if (inherited) signals.push(`domaine hérité:${opts.sourceDomains!.join('+')}`);
  if (inherited) for (const d of opts.sourceDomains!) if (!domains.includes(d)) domains.push(d);

  if (opts.releaseSource || (tech.includes('ANGULAR') && RELEASE.test(title))) {
    return { verdict: 'MISE_A_JOUR', domains, signals, note: 'Release / version d’un outil suivi' };
  }
  if (fin) {
    return tech.length && novelty
      ? { verdict: 'AMBIGU', domains, signals, note: `Signal financier (« ${fin} ») mais innovation technique possible` }
      : { verdict: 'FINANCE_STARTUP', domains, signals, note: `Signal financier / corporate : « ${fin} »` };
  }
  if (promo) {
    return tech.length && novelty && !/uses|builds|grows|case study|customer/i.test(promo)
      ? { verdict: 'AMBIGU', domains, signals, note: `Signal promotionnel (« ${promo} ») mais nouveauté possible` }
      : { verdict: 'PROMO', domains, signals, note: `Signal promotionnel : « ${promo} »` };
  }
  if (rumor) return { verdict: 'AMBIGU', domains, signals, note: `Rumeur possible : « ${rumor} »` };
  const h = inherited ? ' (domaine hérité de la source)' : '';
  if (tech.length && (novelty || analysis)) return { verdict: 'PERTINENT', domains, signals, note: `Domaine technologique + nouveauté/analyse${h}` };
  if (tech.length) return { verdict: 'AMBIGU', domains, signals, note: `Domaine technologique sans signal de nouveauté dans le titre${h}` };
  if (prosp.length) return { verdict: 'AMBIGU', domains, signals, note: 'Sujet prospectif sans lien technologique explicite' };
  return { verdict: 'HORS_SUJET', domains, signals, note: 'Aucun domaine Dunggle détecté' };
}

/** Similarité de titres (Jaccard sur mots significatifs) pour la détection de doublons. */
export function titleJaccard(a: string, b: string, tokens: (s: string) => string[]): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
