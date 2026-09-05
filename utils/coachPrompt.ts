import { BusinessSnapshot } from './businessData';

function fmt(n: number): string {
  return n.toLocaleString('fr-FR') + ' GNF';
}

function pct(n: number): string {
  return `${n}%`;
}

// Strip characters that could break prompt structure or attempt LLM injection via
// user-supplied names (clients, debtors, factory name). Keeps printable non-control chars.
function s(raw: string): string {
  return raw
    .replace(/[\r\n\t\v\f]/g, ' ')
    .replace(/[`*#\[\]<>{};\\]/g, '')
    .slice(0, 80)
    .trim();
}

export function buildSystemPrompt(factoryName: string): string {
  return `Tu es Orny AI, l'intelligence de ${s(factoryName)}, une usine de production. Tu as accès aux données temps réel de l'usine.

**Ta mission unique**
Un seul objectif justifie chacune de tes réponses : aider ${s(factoryName)} à fabriquer les meilleurs produits possibles, le plus efficacement possible, avec ce qu'elle a déjà. Pas de conseil business générique — chaque recommandation doit partir des vrais chiffres de cette usine, jamais d'une généralité qui "s'applique à toute PME".

**Comment tu traites un problème concret (méthode d'Elon Musk — dans cet ordre strict)**
Quand on te soumet un problème réel (une machine en panne, un rendement qui baisse, un nouveau process à mettre en place), applique ces 5 étapes DANS L'ORDRE. Ne saute jamais à l'automatisation avant d'avoir simplifié — automatiser un mauvais process ne fait que produire du gaspillage plus vite.
1. Remettre en question l'exigence elle-même — est-elle vraiment nécessaire, ou juste une habitude jamais questionnée ?
2. Supprimer la pièce ou l'étape — peut-on l'éliminer complètement plutôt que l'améliorer ?
3. Simplifier ou optimiser ce qui reste — seulement une fois le superflu supprimé.
4. Accélérer le cycle — une fois simplifié, comment aller plus vite ?
5. Automatiser — en dernier, jamais en premier.

**Théorie des contraintes (Eliyahu Goldratt — Le But)**
Il y a TOUJOURS UN SEUL goulot qui limite les résultats du système entier. Applique les 5 étapes de focalisation :
1. Identifier le goulot — production (capacité) ? ventes (demande) ? stock (matières) ? trésorerie (cash) ?
2. Exploiter le goulot à fond avant tout investissement — en tirer le maximum avec l'existant.
3. Subordonner tout le reste au goulot — le reste du système sert le goulot, jamais l'inverse.
4. Élever le goulot — investir seulement une fois les 2 premières étapes épuisées.
5. Revenir à l'étape 1 — le goulot se déplace. Ne jamais laisser l'inertie devenir la nouvelle contrainte.
Le débit (Throughput) = revenus encaissés moins les coûts vraiment variables (matières premières).
Quand les données MACHINES ci-dessous existent, compare la capacité nominale à la production réelle — un goulot machine se voit d'abord là, pas dans les chiffres de vente. Si aucune machine n'est encore enregistrée, dis-le clairement plutôt que de deviner une capacité.

**Toyota Production System (The Toyota Way)**
- Muda / Mura / Muri — traque le gaspillage, l'irrégularité et la surcharge, pas seulement les coûts en GNF.
- Jidoka — un défaut détecté doit arrêter la ligne, jamais continuer à produire du rebut.
- Juste-à-temps — produire ce qu'il faut, quand il le faut, pas plus (le stock qui dort est du cash immobilisé).
- Kaizen — préfère l'amélioration continue et petite à un grand bouleversement risqué.
- Genchi Genbutsu — raisonne à partir de ce qui se passe réellement sur la ligne, pas d'une supposition théorique — et dis-le explicitement quand la réponse dépend d'aller vérifier sur place (une machine, un lot, un stock physique) plutôt que des chiffres seuls.

**Alex Hormozi — Vélocité des revenus**
- Taux de recouvrement = encaissé / facturé (objectif > 95%). Le crédit, c'est une illusion de revenu.
- Valeur moyenne par transaction — peut-on la monter avec des lots ou des upsells ?
- Concentration client — si un seul client représente > 40% des ventes, c'est un risque existentiel.

**Ton style**
- Réponds toujours dans la langue utilisée par l'utilisateur (français, portugais, espagnol ou anglais) — pas systématiquement en français.
- Direct, précis, chiffres à l'appui. Zéro blabla.
- Donne UNE action prioritaire concrète, pas une liste de dix.
- Sois exigeant mais bienveillant — tu veux que cette usine prospère.
- Si les données sont bonnes, dis-le. Si c'est mauvais, dis-le franchement.
- Ne cite jamais un chiffre qui n'apparaît pas explicitement dans les données ci-dessous — si une information manque, dis-le plutôt que de l'inventer.

**Format de tes analyses**
🔍 Diagnostic — ce que les données révèlent vraiment
🚧 Goulot principal — le frein #1 du système aujourd'hui
⚡ Action prioritaire — ce qu'il faut faire AUJOURD'HUI
📈 Signal — tendance positive ou alarme à surveiller`;
}

const MACHINE_STATUS_LABEL: Record<string, string> = {
  running: '✅ en marche',
  idle: '⏸️ à l’arrêt',
  down: '🚨 en panne',
  maintenance: '🔧 en maintenance',
};

export function buildDataContext(snap: BusinessSnapshot): string {
  const { sales, production, stock, machines, financial } = snap;

  const topProductLines =
    production.topProducts.length > 0
      ? production.topProducts.map(p => `  - ${s(p.name)}: ${p.unitsProduced} unités`).join('\n')
      : '  - Aucune production cette semaine';

  const materialLines =
    production.materialsConsumedWeek.length > 0
      ? production.materialsConsumedWeek.map(m => `  - ${s(m.name)}: ${m.quantity} ${m.unit}`).join('\n')
      : '  - Aucune matière consommée cette semaine';

  const machineLines =
    machines.items.length > 0
      ? machines.items
          .map(m => {
            const capacity = m.ratedCapacity !== null ? ` | capacité nominale ${m.ratedCapacity} ${m.capacityUnit ?? ''}` : '';
            return `  - ${s(m.name)} (${s(m.type || 'type non précisé')}) → ${MACHINE_STATUS_LABEL[m.status] ?? m.status}${capacity}`;
          })
          .join('\n')
      : '  - Aucune machine enregistrée pour l’instant';

  const stockLines = stock.items.length > 0
    ? stock.items
        .map(item => {
          const statusTag = item.status === 'ok' ? '✅ OK' : item.status === 'low' ? '⚠️ BAS' : '🚨 CRITIQUE';
          const runrate = item.daysOfCover !== null
            ? ` | épuisement dans ~${item.daysOfCover}j au rythme actuel (${item.dailyConsumption}/j)`
            : '';
          return `  - ${item.name}: ${item.currentLevel} ${item.unit} (seuil ${item.alertThreshold}) → ${statusTag}${runrate}`;
        })
        .join('\n')
    : '  - Aucun stock enregistré';

  const debtorLines =
    sales.topDebtors.length > 0
      ? sales.topDebtors.map(d => `  - ${s(d.name)}: ${fmt(d.debt)}`).join('\n')
      : '  - Aucune créance en cours';

  const clientLines =
    sales.topClients.length > 0
      ? sales.topClients.map(c => `  - ${s(c.name)}: ${fmt(c.revenue)}`).join('\n')
      : '  - Aucune vente cette semaine';

  const date = new Date(snap.generatedAt).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `━━━ DONNÉES EN TEMPS RÉEL — ${date} ━━━

📦 VENTES
  Aujourd'hui : ${sales.today.count} vente(s) | Facturé ${fmt(sales.today.revenue)} | Encaissé ${fmt(sales.today.collected)} | Créance ${fmt(sales.today.debt)}
  Cette semaine : ${sales.week.count} vente(s) | Facturé ${fmt(sales.week.revenue)} | Encaissé ${fmt(sales.week.collected)} | Créance ${fmt(sales.week.debt)}
  Ce mois : ${sales.month.count} vente(s) | Facturé ${fmt(sales.month.revenue)} | Encaissé ${fmt(sales.month.collected)}
  Mix paiement (historique) : Cash ${pct(sales.paymentMix.cash)} | Orange Money ${pct(sales.paymentMix.orangeMoney)} | Crédit ${pct(sales.paymentMix.credit)}
  Valeur moy. transaction (semaine) : ${fmt(sales.avgTransactionValue)}
  Taux de recouvrement global : ${pct(sales.allTime.collectionRate)}
  Client principal cette semaine : ${s(sales.week.topClient)}

Top clients (semaine) :
${clientLines}

Top débiteurs :
${debtorLines}

🏭 PRODUCTION
  Aujourd'hui : ${production.today.batches} lot(s) | ${production.today.unitsProduced} unités produites | ${production.today.hours}h travaillées
  Cette semaine : ${production.week.batches} lot(s) | ${production.week.unitsProduced} unités produites | ${production.week.hours}h travaillées
  Objectif hebdo : ${production.weeklyTarget} unités → ${pct(production.weeklyProgress)} atteint
  Couverture prod / ventes (semaine) : ${pct(production.productionCoverage)}
  Ce mois : ${production.month.batches} lot(s) | ${production.month.unitsProduced} unités produites

Produits fabriqués cette semaine :
${topProductLines}

Matières consommées cette semaine :
${materialLines}

⚙️ MACHINES (${machines.total} au total : ${machines.running} en marche, ${machines.idle} à l'arrêt, ${machines.maintenance} en maintenance, ${machines.down} en panne)
${machineLines}

📊 STOCK
${stockLines}

💰 FINANCE
  Capital investi total : ${fmt(financial.totalCapitalInvested)}
  Revenus 30 derniers jours : ${fmt(financial.estimatedRevenueLast30d)}
  Cash réellement encaissé (30j) : ${fmt(financial.cashReceivedLast30d)}
  Taux recouvrement 30j : ${pct(financial.collectionRate30d)}
  Créances totales en suspens : ${fmt(financial.outstandingDebt)}
  Revenu par batch (semaine) : ${fmt(financial.revenuePerBatch)}
  Dépenses ce mois : ${fmt(financial.expensesThisMonth)}
  Profit net ce mois : ${fmt(financial.netProfitThisMonth)}${financial.netProfitThisMonth < 0 ? ' ⚠️ PERTE' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

export function buildBriefPrompt(snap: BusinessSnapshot, factoryName: string): string {
  return `${buildDataContext(snap)}

Génère le BILAN DU JOUR pour ${s(factoryName)}.

Structure exacte :
1. Une phrase d'accroche directe sur l'état du business (honnête, sans ménagement)
2. 🔍 Diagnostic : les 2-3 insights les plus importants que révèlent ces données
3. 🚧 Goulot principal : identifie LE frein #1 qui limite les résultats aujourd'hui (Goldratt)
4. ⚡ Action prioritaire : 1 seule action concrète à faire aujourd'hui pour débloquer la situation
5. 📈 Signal : 1 chose qui marche bien (ou 1 alarme critique si tout est mauvais)

Règles : cite des chiffres réels. Max 280 mots. Pas de formules creuses.`;
}
