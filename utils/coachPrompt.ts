import { BusinessSnapshot } from './businessData';

function fmt(n: number): string {
  return n.toLocaleString('fr-FR') + ' GNF';
}

function pct(n: number): string {
  return `${n}%`;
}

export function buildSystemPrompt(factoryName: string): string {
  return `Tu es le Coach IA de ${factoryName}, un conseiller d'entreprise d'élite pour cette usine de production. Tu as accès aux données temps réel de l'usine.

Tu appliques deux cadres complémentaires :

**Alex Hormozi — Vélocité des revenus**
- Taux de recouvrement = encaissé / facturé (objectif > 95%). Le crédit, c'est une illusion de revenu.
- Valeur moyenne par transaction (ATV) — peut-on la monter avec des lots ou des upsells ?
- Concentration client — si un seul client représente > 40% des ventes, c'est un risque existentiel.
- Vélocité = combien de cycles argent→stock→production→vente→argent par semaine ?

**Eliyahu Goldratt — Théorie des contraintes**
- Il y a TOUJOURS UN SEUL goulot qui limite les résultats du système entier.
- Identifier le goulot : est-ce la production (capacité) ? les ventes (demande) ? le stock (matières) ? la trésorerie (cash) ?
- Exploiter le goulot à fond avant tout investissement.
- Subordonner tout le reste au goulot.
- Le débit (Throughput) = revenus encaissés moins les coûts vraiment variables (matières premières).

**Ton style**
- Parle toujours en français.
- Direct, précis, chiffres à l'appui. Zéro blabla.
- Donne UNE action prioritaire concrète, pas une liste de 10.
- Sois un mentor exigeant mais bienveillant — tu veux que cette usine prospère.
- Si les données sont bonnes, dis-le. Si c'est mauvais, dis-le franchement.

**Format de tes analyses**
🔍 Diagnostic — ce que les données révèlent vraiment
🚧 Goulot principal — le frein #1 du système aujourd'hui
⚡ Action prioritaire — ce qu'il faut faire AUJOURD'HUI
📈 Signal — tendance positive ou alarme à surveiller`;
}

export function buildDataContext(snap: BusinessSnapshot): string {
  const { sales, production, stock, financial } = snap;

  const stockLines = stock.items.length > 0
    ? stock.items
        .map(
          item =>
            `  - ${item.name}: ${item.currentLevel} ${item.unit} (seuil ${item.alertThreshold}) → ${
              item.status === 'ok' ? '✅ OK' : item.status === 'low' ? '⚠️ BAS' : '🚨 CRITIQUE'
            }`
        )
        .join('\n')
    : '  - Aucun stock enregistré';

  const debtorLines =
    sales.topDebtors.length > 0
      ? sales.topDebtors.map(d => `  - ${d.name}: ${fmt(d.debt)}`).join('\n')
      : '  - Aucune créance en cours';

  const clientLines =
    sales.topClients.length > 0
      ? sales.topClients.map(c => `  - ${c.name}: ${fmt(c.revenue)}`).join('\n')
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
  Client principal cette semaine : ${sales.week.topClient}

Top clients (semaine) :
${clientLines}

Top débiteurs :
${debtorLines}

🏭 PRODUCTION
  Aujourd'hui : ${production.today.batches} batch(es) | ${production.today.sachets} sachets | ${production.today.potatoesKg} kg PDT | ${production.today.hours}h travaillées
  Cette semaine : ${production.week.batches} batch(es) | ${production.week.sachets} sachets | ${production.week.potatoesKg} kg PDT | ${production.week.hours}h
  Rendement moyen semaine : ${production.week.avgYield} g/kg | Rendement moyen global : ${production.avgYieldGPerKg} g/kg
  Objectif hebdo : ${production.weeklyTarget} sachets → ${pct(production.weeklyProgress)} atteint
  Couverture prod / ventes : ${pct(production.productionCoverage)} (si > 100% = stock de sachets en cours)
  Ce mois : ${production.month.batches} batch(es) | ${production.month.sachets} sachets

📊 STOCK
${stockLines}

💰 FINANCE
  Capital investi total : ${fmt(financial.totalCapitalInvested)}
  Revenus 30 derniers jours : ${fmt(financial.estimatedRevenueLast30d)}
  Cash réellement encaissé (30j) : ${fmt(financial.cashReceivedLast30d)}
  Taux recouvrement 30j : ${pct(financial.collectionRate30d)}
  Créances totales en suspens : ${fmt(financial.outstandingDebt)}
  Revenu par batch (semaine) : ${fmt(financial.revenuePerBatch)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

export function buildBriefPrompt(snap: BusinessSnapshot, factoryName: string): string {
  return `${buildDataContext(snap)}

Génère le BILAN DU JOUR pour ${factoryName}.

Structure exacte :
1. Une phrase d'accroche directe sur l'état du business (honnête, sans ménagement)
2. 🔍 Diagnostic : les 2-3 insights les plus importants que révèlent ces données
3. 🚧 Goulot principal : identifie LE frein #1 qui limite les résultats aujourd'hui (Goldratt)
4. ⚡ Action prioritaire : 1 seule action concrète à faire aujourd'hui pour débloquer la situation
5. 📈 Signal : 1 chose qui marche bien (ou 1 alarme critique si tout est mauvais)

Règles : cite des chiffres réels. Max 280 mots. Pas de formules creuses.`;
}
