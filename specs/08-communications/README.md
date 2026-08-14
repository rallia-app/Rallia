# 08 - Communications

> In-app chat, notifications, and content moderation.

## Overview

The communications system enables players to message each other and receive notifications about matches, groups, and other activities.

## Sub-documents

| Document                                                                     | Description                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| [chat.md](./chat.md)                                                         | 1:1 and group chat functionality                         |
| [match-organizer-live-suggestions.md](./match-organizer-live-suggestions.md) | Auto-posted, self-refreshing time/place suggestion cards |
| [notifications.md](./notifications.md)                                       | Push, email, and SMS notifications                       |
| [moderation.md](./moderation.md)                                             | Content moderation and safety                            |

## User Stories

- As a player, I want to chat with my match partner to coordinate details
- As a group member, I want to communicate with my group
- As a player, I want to receive notifications about match invitations
- As a player, I want to control what notifications I receive

## Dependencies

| System                                                  | Relationship                                 |
| ------------------------------------------------------- | -------------------------------------------- |
| [06 Player Relations](../07-player-relations/README.md) | Groups and communities have associated chats |
| [08 Matches](../09-matches/README.md)                   | Match acceptance enables chat                |
| [02 Sport Modes](../02-sport-modes/README.md)           | Notifications indicate sport context         |

## Communication Channels

| Channel            | Use Case                       |
| ------------------ | ------------------------------ |
| In-App Chat        | 1:1 and group messaging        |
| Push Notifications | Real-time alerts               |
| Email              | Match confirmations, digests   |
| SMS                | Match reminders, urgent alerts |

## Key Features

- 1:1 chat between matched players
- Group chat for groups and communities
- Chat within matches
- Blocking users blocks messages
- Automatic content moderation

## UX Suggestions

- Add reactions (👍, 🎾, etc.) for quick responses
- Pre-written quick replies for common messages
- Read receipts optional
