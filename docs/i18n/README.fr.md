# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity est un module Obsidian local et en lecture seule qui aide à repérer les Broken links et les Isolated files.

## Captures d’écran

Consultez les liens invalides et les fichiers isolés dans une barre latérale compacte :

![Barre latérale Link Integrity](../assets/link-integrity-overview-en.png)

![Fichiers isolés regroupés par dossier](../assets/link-integrity-isolated-en.png)

Gérez l’index, les règles d’exclusion, les types de fichiers et les règles d’isolation attendue dans les paramètres Obsidian :

![Paramètres de Link Integrity](../assets/link-integrity-settings-en.png)

## Fonctionnalités

- Repère les liens internes vers des fichiers, titres ou blocs manquants dans Markdown, les incorporations, le Frontmatter, Canvas et les références de fichiers explicites de Bases.
- Repère les fichiers qui n’ont aucune connexion entrante ou sortante valide avec un autre fichier existant du Vault. Les liens vers soi-même et les URL externes ne comptent pas comme connexions du Vault.
- Signale lorsqu’un fichier isolé contient aussi des liens sortants invalides, afin d’éviter de le prendre pour un fichier manifestement supprimable.
- Les notes périodiques, modèles, archives et fichiers similaires peuvent être marqués Expected isolated. Cela change uniquement leur classement dans les résultats, pas leurs véritables liens.
- Filtre les fichiers isolés par fichiers Obsidian, formats d’image, audio, vidéo, PDF et extensions de pièces jointes configurées.
- Construit un index complet quand c’est nécessaire, puis le tient à jour automatiquement lorsque le Vault change.
- Ouvre chaque problème à sa source lorsqu’une navigation précise est disponible. L’analyse et l’indexation restent locales.

Les résultats dynamiques des requêtes Bases ne sont pas automatiquement considérés comme des liens. Si le fichier cible existe mais qu’un titre ou un bloc manque, les deux fichiers restent considérés comme reliés et l’élément manquant est signalé séparément.

## Prérequis et compatibilité

- Obsidian 1.12.7 ou version ultérieure.
- Compatible avec Obsidian sur ordinateur et mobile.
- Seul le Vault courant est vérifié. Les sites Web externes et ressources distantes ne le sont pas.

## Installation

Ouvrez **Paramètres → Modules complémentaires → Parcourir**, recherchez **Link Integrity** et installez-le. S’il n’apparaît pas dans le catalogue, téléchargez `link-integrity-<version>.zip` depuis la [dernière version GitHub](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest).

Pour une installation manuelle, placez `main.js`, `manifest.json` et `styles.css` dans `Vault/.obsidian/plugins/link-integrity/`. Lors d’une mise à niveau, remplacez seulement ces trois fichiers et conservez `data.json`, sauf si vous souhaitez réinitialiser les paramètres.

## Utilisation

1. Activez Link Integrity dans les modules complémentaires.
2. Ouvrez Link Integrity depuis le ruban ou la palette de commandes. La barre latérale contient **Broken links** et **Isolated files**.
3. Sélectionnez un résultat pour ouvrir sa source. Les filtres de fichiers isolés ne changent que la vue courante, pas vos valeurs par défaut enregistrées.
4. L’analyse au démarrage est désactivée par défaut. L’ouverture de la barre latérale construit l’index lorsque nécessaire ; vous pouvez aussi utiliser **Construire l’index** ou **Reconstruire l’index** dans Général. Après la première construction réussie, les changements du Vault mettent les résultats à jour automatiquement.

## Paramètres

- **Général** : langue, analyse au démarrage, vues par défaut et commandes de construction/reconstruction de l’index. La langue par défaut est **Suivre Obsidian**.
- **Broken links** : types de problèmes affichés et règles d’exclusion nommées avec aperçu des correspondances.
- **Isolated files** : types de fichiers par défaut, vue facultative sans lien entrant, fichiers Expected isolated, règles d’exclusion et règles d’isolation attendue.
- Les règles d’isolation attendue peuvent combiner type de fichier, dossier seul ou avec sous-dossiers, formats de date, motifs glob et expressions régulières avancées. Le préréglage des notes périodiques couvre jour, semaine, mois, trimestre et année.

Les paramètres et règles utilisateur sont stockés dans `data.json`. L’index de liens calculé reste en mémoire et est reconstruit après un redémarrage.

## Limitations

- Link Integrity ne supprime aucun fichier, ne réécrit aucun lien et ne décide pas automatiquement de ce qui doit être supprimé.
- Les URL externes sont volontairement hors périmètre et ne sont jamais interrogées sur le réseau.
- Les résultats dynamiques de Bases ne comptent pas comme connexions directes entre fichiers ; seules les références explicites comptent.
- Les règles d’isolation attendue modifient seulement le classement des fichiers déjà isolés. Elles ne masquent pas les liens invalides et ne suppriment pas les connexions réelles.

## Confidentialité et sécurité

L’indexation et l’évaluation des règles s’exécutent entièrement en local. Link Integrity ne téléverse pas le contenu du Vault, ne demande aucun compte et ne modifie pas les notes. Les chemins et exemples de diagnostic restent dans la session Obsidian tant que vous ne choisissez pas de les partager.

## Développement

Utilisez Node.js 24.19.0 et npm 11.17.0. Exécutez `npm ci`, puis `npm run check`.

Documentation développeur : [produit](../product-requirements.en.md), [UX](../ux-spec.en.md), [architecture](../architecture.en.md), [tests](../testing-strategy.en.md). Les sources chinoises correspondantes se trouvent dans le même dossier.

## Assistance

- [Q&A](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/q-a): Questions d’utilisation et de configuration.
- [Ideas](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/ideas): Idées de fonctionnalités ou de flux de travail encore en discussion.
- [Show and tell](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/show-and-tell): Astuces, flux de travail et exemples.

Utilisez [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues/new/choose) pour les bogues reproductibles et les demandes concrètes. Ne publiez pas de chemins privés du Vault, de contenu de notes, d’exemples de diagnostic ni d’informations personnelles.

## Licence

[MIT](../../LICENSE) © ZhengYX
