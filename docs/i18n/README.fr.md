# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity est un module de diagnostic Obsidian local et en lecture seule pour les Broken links et les Isolated files.

## Captures d’écran

Examiner les liens invalides et les fichiers isolés dans une barre latérale compacte :

![Barre latérale Link Integrity](../assets/link-integrity-overview-en.png)

Configurer l’index, les règles d’exclusion, les types de fichiers et l’isolation attendue dans les paramètres Obsidian :

![Paramètres Link Integrity](../assets/link-integrity-settings-en.png)

## Fonctionnalités

- Signale les références internes invalides vers des fichiers, titres et blocs depuis Markdown, les incorporations, le Frontmatter, Canvas et les références de fichiers explicites de Bases.
- Trouve les fichiers sans connexion entrante ni sortante valide avec un autre fichier existant du Vault ; les auto-liens et URL externes ne créent pas de connexion.
- Marque comme moins fiables les fichiers isolés contenant des liens sortants invalides.
- Place facultativement notes périodiques, modèles et archives dans Expected isolated sans inventer d’arêtes.
- Filtre les fichiers Obsidian, familles d’images, audio, vidéo, PDF et extensions de pièces jointes configurées.
- Construit une base complète si nécessaire, puis applique les mises à jour incrémentales du Vault.
- Ouvre chaque diagnostic à sa source ; analyse, règles et index restent locaux.

Les résultats dynamiques de Bases ne sont pas des arêtes explicites. Un fichier résolu dont le titre ou le bloc manque conserve sa connexion au niveau du fichier et reçoit un diagnostic de sous-chemin séparé.

## Prérequis et compatibilité

- Obsidian 1.12.7 ou version ultérieure.
- Prévu pour ordinateur et mobile ; chaque hôte et appareil réel reste une frontière de validation distincte.
- Seul le Vault courant est diagnostiqué ; le Web externe n’est pas contrôlé.

## Installation

Après approbation dans l’annuaire communautaire, installez Link Integrity depuis **Paramètres → Modules complémentaires → Parcourir**. Vous pouvez aussi télécharger `link-integrity-<version>.zip` depuis la [dernière version GitHub](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest).

Pour une installation manuelle, placez `main.js`, `manifest.json` et `styles.css` dans `Vault/.obsidian/plugins/link-integrity/`. Lors d’une mise à niveau, remplacez seulement ces trois fichiers et conservez `data.json`, sauf réinitialisation volontaire.

## Utilisation

1. Activez Link Integrity dans les modules complémentaires.
2. Ouvrez la barre latérale depuis le ruban ou la palette de commandes, puis choisissez **Broken links** ou **Isolated files**.
3. Sélectionnez un diagnostic pour ouvrir sa source ; les filtres ne modifient que la vue courante.
4. Si l’analyse au démarrage est désactivée ou si la base a échoué, utilisez **Construire l’index** ou **Reconstruire l’index** dans Général. Les mises à jour incrémentales prennent ensuite le relais.

## Paramètres

- **Général** : langue, analyse au démarrage, regroupement et action de construction/reconstruction. La valeur par défaut est **Suivre Obsidian**.
- **Broken links** : catégories de diagnostic et règles d’exclusion nommées avec aperçu.
- **Isolated files** : types de fichiers par défaut, analyse facultative sans lien entrant, visibilité Expected isolated et règles.
- Les règles d’isolation attendue combinent type, dossier exact ou récursif, format de date, glob et expression régulière ; le préréglage périodique couvre jour, semaine, mois, trimestre et année.

Les paramètres et règles sont stockés dans `data.json` ; le graphe dérivé ne l’est pas.

## Limitations

- Aucun fichier n’est supprimé et aucun lien n’est réécrit automatiquement.
- Les URL externes ne sont pas demandées sur le réseau.
- Les requêtes dynamiques Bases ne comptent pas comme connexions explicites.
- Les règles Expected isolated n’affectent que la projection des candidats et ne masquent jamais les liens invalides.
- Les tests automatisés ne remplacent pas la validation sur des versions et appareils Obsidian réels.

## Confidentialité et sécurité

Tout s’exécute localement. Link Integrity ne téléverse pas le contenu du Vault, n’exige aucun compte, ne modifie pas les notes et ne conserve pas le graphe dérivé.

## Développement

Utilisez Node.js 24.18.0 et npm 11.16.0. Exécutez `npm ci`, puis `npm run check`.

Contrats stables : [produit](../product.en.md), [UX](../ux.en.md), [architecture](../architecture.en.md), [tests](../testing-strategy.en.md) et [publication](../release.en.md). Les sources chinoises correspondantes sont dans le même dossier.

## Assistance

Utilisez [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues) pour les bogues reproductibles et demandes concrètes. Ne publiez jamais de chemins de Vault, de contenu de notes ou d’échantillons privés.

## Licence

[MIT](../../LICENSE) © ZhengYX
