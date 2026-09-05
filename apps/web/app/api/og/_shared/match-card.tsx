/**
 * The game card behind every shared game link: a duel poster while spots are
 * open, a scoreboard once a score is registered and uncontested.
 *
 * Two routes render it. `/match/[id]/opengraph-image` serves the bare link, and
 * `/api/og/invite?type=match&id=…` serves the one the app hands out, which
 * carries a referral code and so cannot use the file convention. Both call in
 * here so the artwork has one home.
 */
import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { getStorageImageUrl } from '@rallia/shared-utils';
import { primary, neutral, accent, status } from '@rallia/design-system';

import type { MatchWithRelations } from '@/lib/match/get-match';
import { loadOgFonts } from '@/lib/og-fonts';

// Inline base64-encoded logo SVG to avoid filesystem/network issues on Vercel serverless
const LOGO_BASE64 =
  'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyAgIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgdmlld0JveD0iMCAwIDEzMzAuNjUgNTE4LjMyIj4KICA8cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNMTU4LjA2LDEzOS44N2MxNDcuNDksMTUuNDMsMTg1LjE5LDE1OS44LDU1LjE3LDIzMC45OWw4MC44MywxNDIuMjUtMTAzLjAxLTMuNWMtMTQuMzktOC43MS01My4xOC0xMTIuNTgtNjkuODctMTI4LjA2LTkuMjUtOC41OC0xMy4wNy04Ljg3LTI1LjYxLTcuNDR2MTM5LjA4SDBWMTM4LjMyYzQ4LjU2LS4yNiwxMTEuNjYtMy4zLDE1OC4wNiwxLjU1aDBaTTE4OS40LDIyOS40NWMtMTUuOTctMTUuOTYtNzEuMDEtNi42Mi05My44Ni01LjA5djg3LjkxYzMzLjUxLTEuMjYsOTUuNDYsMTIuMjQsMTAzLjA2LTMzLjM2LDEuOTItMTEuNTItMS4wNS0zNy4zMi05LjE5LTQ1LjQ2aC0uMDFaIi8+CiAgPHJlY3QgZmlsbD0iI2ZmZmZmZiIgeD0iNjQ2Ljk0IiB5PSIxMjUuMjQiIHdpZHRoPSI5NS41NyIgaGVpZ2h0PSIzODcuOTYiLz4KICA8cmVjdCBmaWxsPSIjZmZmZmZmIiB4PSI3NzkuMjciIHk9IjEyNS4yNCIgd2lkdGg9Ijk1LjU3IiBoZWlnaHQ9IjM4Ny45NiIvPgogIDxyZWN0IGZpbGw9IiNmZmZmZmYiIHg9IjkwNC4yNSIgeT0iMjIwLjM5IiB3aWR0aD0iOTUuNTciIGhlaWdodD0iMjkyLjgiLz4KICA8cGF0aCBmaWxsPSIjZmRkNDRlIiBkPSJNOTUyLjQ2LDg0LjE1YzY2LjAxLTMuNDksNzIuMDUsOTQuODgsNS4wNyw5OC4xNy03Mi44NCwzLjU4LTgwLjkzLTk0LjE1LTUuMDctOTguMTdaIi8+CiAgPHBhdGggZmlsbD0iI2ZkZDQ0ZSIgZD0iTTg5Ni42OSw3NS44MWMtMTIyLjU1LTIzLjIyLTQyMy43OS0xMDAuOTQtNDk1LjQzLDM1LjE3LTUuNDEsMTAuMzItOS40OCwyMS41OS0xMi42NCwzMy4zNC0uNTEtMTIuMTYuNzgtMjQuNTUsNC4wNi0zNi42NywyLjQ1LTkuMTIsNi4xMy0xOC4xMiwxMC45MS0yNi4zNSwyNC40OC00Mi41Niw3Mi43Ny02NC4zLDExOS4wNy03My45MiwxMjAuMzYtMjMuODgsMjY2LjQsMTMuMTcsMzc0LjAzLDY4LjQzaDBaIi8+CiAgPHBhdGggZmlsbD0iI2ZkZDQ0ZSIgZD0iTTg3OS41LDEwNi4yN2MtMTA4Ljg1LTEzLjE4LTI3Ni00OS42Mi0zNjcuNjMsMjIuOTQtMy40MiwyLjY5LTYuNzUsNS41Mi05Ljk2LDguNDgtNi40NSw1Ljk3LTEyLjUyLDEyLjU1LTE4LjQyLDE5LjU2LDUuMzItMTcuNTQsMTUuMjQtMzMuOTYsMjguMTktNDcuOTEsODcuMTEtOTAuOTEsMjY4LjQ2LTU4LjI1LDM2Ny44My0zLjA3aDBaIi8+CiAgPGc+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBkPSJNNTIyLjgzLDIyNi4zN2wtLjA0LDM2LjEyYy05Ny44NC05My45Mi0yMjAuNzUtMTUuNjUtMjE4LjA5LDExMS45NSwyLjUzLDEyMS40NiwxMjQuNjEsMTkyLjgyLDIxOC4wOSwxMDQuNTVsLjA0LDM2LjEyLDg3LjEtLjA0VjIyNi40MmwtODcuMS0uMDRoMFpNNTUzLjk1LDQyOS4xNHYuMTVjMCwuMDctLjAzLjE1LS4wNS4yMy0uMDEuMDUtLjAyLjEtLjA0LjE1LS4wMy4wOS0uMDguMi0uMTIuMy0uMDIuMDUtLjA0LjA5LS4wNi4xNC0uMDguMTYtLjE3LjMzLS4yOC41Mi0uODksMS41Mi02LjQ4LDkuMy04LjA0LDEwLjgxLS4xLjEtLjE5LjE3LS4yNi4yMS0xLjk2LDEuMjEtMi44NS0uOTMtMy45OC0xLjc4LTEzLjc4LTEwLjMxLTI3LjU4LTIwLjY1LTQxLjY4LTMwLjU4LTEuNTItMS4wNy0yLjgxLS42Ny0zLjUyLTMuMDktLjIzLS43OC4wNy0xLjY2LjAyLTEuNzktLjY1LTEuNzEtMTMuMjYtNi4zMy0xNS43My03LjAxLTYuODItMS44OC0xMy43Mi0xLjEtMjAuODEtMS41Mi0xMC43Ny0uNjMtMjEuNTctMS40My0zMi4yOS0yLjE1LTM4LjMyLTIuNTgtODUuNTYtNDcuNjUtNDcuOTQtODcuOC40LS40Mi43OS0uODMsMS4xOS0xLjIzLDI1LjI0LTI1LjI3LDYxLjI2LTEwLjEsNzkuNSwxMS4yNywxMC4wMiwxMS43NCwxNi4xMSwyOC40OCwyMi4xOSw0Mi45OSw0LjQyLDEwLjU1LDYuMDcsMTkuMDUsMTMuNTcsMjgsMS4wMSwxLjIxLDYuNTMsNy40OSw3LjQ5LDcuNTMuMTcsMCwuNzktLjU1LDEuNDItLjU5LDIuNDctLjE3LDIuMjkuOSwzLjczLDEuOTUsMi4zNywxLjczLDQuNzUsMy40Niw3LjEyLDUuMi0uMjIuMDgtLjQyLjIzLS41Ny40M2wtNS43NSw3LjgxYy0uNDEuNTYtLjI5LDEuMzQuMjcsMS43NXMxLjM1LjI5LDEuNzYtLjI3bDUuNzUtNy44MWMuMTUtLjIxLjIzLS40NS4yNC0uNjgsMS44NiwxLjM2LDMuNzEsMi43MSw1LjU3LDQuMDYuNzQuNTQsMS40OCwxLjA4LDIuMjMsMS42Mi4yLjE0LjM5LjI4LjU5LjQybC01Ljc0LDcuNzljLS40MS41Ni0uMjksMS4zNC4yNywxLjc1czEuMzUuMjksMS43Ni0uMjdsNS43NS03LjgxYy45OC43MSwxLjk2LDEuNDEsMi45NSwyLjEyLjg1LjYsMS43LDEuMiwyLjU0LDEuOCwxLjAyLjcyLDIuMDMsMS40NCwzLjA2LDIuMTZsLTUuNzUsNy44MWMtLjQxLjU2LS4yOSwxLjM0LjI3LDEuNzVzMS4zNS4yOSwxLjc2LS4yN2w1Ljc1LTcuODFzLjAyLS4wNC4wNC0uMDdjLjE4LjEyLjM2LjI1LjU0LjM3LDEuMDEuNywyLjAzLDEuNDEsMy4wNSwyLjEuODYuNTksMS43NCwxLjE2LDIuNiwxLjc0LjMzLjIyLjY3LjQ1LDEsLjY3bC01LjY5LDcuNzJjLS40MS41Ni0uMjksMS4zNC4yNywxLjc1czEuMzUuMjksMS43Ni0uMjdsNS43NS03LjgxYy44OS41OCwxLjc4LDEuMTUsMi42NywxLjcyLDEuMDUuNjgsMi4wOSwxLjM2LDMuMTQsMi4wMy4wMy4wNS4wNS4wOC4wOC4xM2gwcy4wNS4wOC4wOC4xM2MuMDUuMDguMTEuMTYuMTUuMjQuMDQuMDcuMDguMTQuMTIuMjEuMDQuMDYuMDcuMTMuMS4xOXMuMDYuMTMuMDkuMTljLjAyLjA1LjA1LjExLjA3LjE2LjAyLjA2LjAzLjEyLjA1LjE5LjAxLjA1LjAzLjEuMDMuMTV2LjJoLS4wNCwwWiIvPgogICAgPHBvbHlnb24gZmlsbD0iIzU2YmNiNyIgb3BhY2l0eT0iMC42IiBwb2ludHM9IjM4NC4zMSAzMzggMzkyLjcxIDM0My45NCAzOTguNDcgMzM2LjE0IDM5MC4wNyAzMzAuMiAzODQuMzEgMzM4Ii8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iMzkxLjc1IDMyNy45MyA0MDAuMTUgMzMzLjg3IDQwNS42NiAzMjYuMzkgMzk3LjI2IDMyMC40NSAzOTEuNzUgMzI3LjkzIi8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iMzk1LjcyIDM2MC45IDQwMS40NyAzNTMuMSAzOTMuMzcgMzQ3LjM3IDM4Ny42MiAzNTUuMTcgMzk1LjcyIDM2MC45Ii8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDA5LjQ0IDMyNS42IDQxNy41NCAzMzEuMzMgNDIzLjI5IDMyMy41NCA0MTUuMiAzMTcuODEgNDA5LjQ0IDMyNS42Ii8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iMzk4Ljk0IDMxOC4xOCA0MDcuMzQgMzI0LjEyIDQxMy4xIDMxNi4zMiA0MDQuNyAzMTAuMzggMzk4Ljk0IDMxOC4xOCIvPgogICAgPHBvbHlnb24gZmlsbD0iIzU2YmNiNyIgb3BhY2l0eT0iMC42IiBwb2ludHM9IjQ0Ni43NiAzNTUuNDYgNDM4LjY2IDM0OS43MyA0MzMuMTQgMzU3LjIgNDQxLjI0IDM2Mi45MyA0NDYuNzYgMzU1LjQ2Ii8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDExLjk3IDM2MC41MiA0MDMuNTcgMzU0LjU4IDM5Ny44MiAzNjIuMzggNDA2LjIyIDM2OC4zMiA0MTEuOTcgMzYwLjUyIi8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDE2LjYzIDMxNS44NiA0MjQuNzMgMzIxLjU5IDQzMC40OSAzMTMuNzkgNDIyLjM5IDMwOC4wNiA0MTYuNjMgMzE1Ljg2Ii8+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIGQ9Ik00NjAuMzEsMzY1LjU0bC0xMS40LTguMDYtNS4wNCw2LjgyLDExLjQsOC4wNmMyLjA2LTIuMDcsMy41Mi00LjM2LDUuMDQtNi44MloiLz4KICAgIDxwb2x5Z29uIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgcG9pbnRzPSI0MjIuMTcgMzY3Ljc0IDQxNC4wNyAzNjIuMDEgNDA4LjMyIDM2OS44MSA0MTYuNDIgMzc1LjUzIDQyMi4xNyAzNjcuNzQiLz4KICAgIDxwb2x5Z29uIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgcG9pbnRzPSI0MjkuMzYgMzU3Ljk5IDQyMS4yNyAzNTIuMjYgNDE1LjUxIDM2MC4wNiA0MjMuNjEgMzY1Ljc5IDQyOS4zNiAzNTcuOTkiLz4KICAgIDxwb2x5Z29uIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgcG9pbnRzPSI0MzkuNTYgMzY1LjIgNDMxLjQ2IDM1OS40OCA0MjUuNzEgMzY3LjI3IDQzMy44MSAzNzMgNDM5LjU2IDM2NS4yIi8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDI2LjgzIDMyMy4wNyA0MzUuMjMgMzI5LjAxIDQ0MC45OSAzMjEuMjEgNDMyLjU5IDMxNS4yNyA0MjYuODMgMzIzLjA3Ii8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDI2LjM2IDM0MS4wMyA0MTcuOTYgMzM1LjA5IDQxMi40NSAzNDIuNTYgNDIwLjg0IDM0OC41IDQyNi4zNiAzNDEuMDMiLz4KICAgIDxwb2x5Z29uIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgcG9pbnRzPSI0MTkuMTcgMzUwLjc4IDQxMC43NyAzNDQuODQgNDA1LjAxIDM1Mi42NCA0MTMuNDEgMzU4LjU4IDQxOS4xNyAzNTAuNzgiLz4KICAgIDxwb2x5Z29uIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgcG9pbnRzPSIzOTQuODEgMzQ1LjQyIDQwMi45MSAzNTEuMTUgNDA4LjY3IDM0My4zNSA0MDAuNTcgMzM3LjYzIDM5NC44MSAzNDUuNDIiLz4KICAgIDxwYXRoIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgZD0iTTQ2NC41NywzNDkuMjZjLjA0LTIuMjQuMDItNC40OC0uMzItNi42Ny0uMDctLjQ0LS44MS00LjQtMS4xOS00LjI5bC00LjgsNi41LDYuMyw0LjQ2aDBaIi8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDE1Ljg2IDMzMy42MSA0MDcuNzYgMzI3Ljg4IDQwMi4yNSAzMzUuMzUgNDEwLjM1IDM0MS4wOCA0MTUuODYgMzMzLjYxIi8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDQzLjA5IDMyMi43IDQzNy4zMyAzMzAuNSA0NDUuNDMgMzM2LjIyIDQ1MS4xOSAzMjguNDMgNDQzLjA5IDMyMi43Ii8+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIGQ9Ik00NjQuNDUsMzUzLjE0bC04LjEtNS43My01LjI4LDcuMTUsMTAuOCw3LjY0YzEuMzItMi45MiwxLjkxLTYuMDEsMi41OC05LjA2aDBaIi8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDM2LjU2IDM0OC4yNCA0MjguNDYgMzQyLjUyIDQyMi45NCAzNDkuOTkgNDMxLjA0IDM1NS43MiA0MzYuNTYgMzQ4LjI0Ii8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDQzLjk5IDMzOC4xNyA0MzUuODkgMzMyLjQ1IDQzMC4xNCAzNDAuMjQgNDM4LjI0IDM0NS45NyA0NDMuOTkgMzM4LjE3Ii8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDMzLjc5IDMzMC45NiA0MjUuMzkgMzI1LjAyIDQxOS42NCAzMzIuODIgNDI4LjA0IDMzOC43NiA0MzMuNzkgMzMwLjk2Ii8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDU0LjE5IDM0NS4zOSA0NDYuMDkgMzM5LjY2IDQ0MC4zNCAzNDcuNDYgNDQ4LjQ0IDM1My4xOCA0NTQuMTkgMzQ1LjM5Ii8+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIGQ9Ik0zOTYuNDQsMzY0Ljg3bC00LjU2LDYuMTdjMi40NSwyLjExLDQuODgsNC4wNSw3LjgsNS41Mmw0LjU2LTYuMTctNy44LTUuNTJaIi8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDQ3LjUzIDMzNy43MSA0NTUuNjMgMzQzLjQ0IDQ2MS4zOCAzMzUuNjQgNDUzLjI5IDMyOS45MSA0NDcuNTMgMzM3LjcxIi8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iMzkxLjI3IDM0NS44OSAzODIuODggMzM5Ljk1IDM3Ny4xMiAzNDcuNzQgMzg1LjUyIDM1My42OCAzOTEuMjcgMzQ1Ljg5Ii8+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIGQ9Ik0zNzQuNTQsMzM0LjU0Yy0uNjYsMS43Ny4yNywzLjc1LS4wOCw1LjY1bDEuMjgsNS4wOSw0LjgtNi41LTYtNC4yNGgwWiIvPgogICAgPHBvbHlnb24gZmlsbD0iIzU2YmNiNyIgb3BhY2l0eT0iMC42IiBwb2ludHM9IjQwMi42MSAzNzguMTkgNDExLjMxIDM4MS44IDQxNC40MyAzNzcuNjUgNDA2LjkzIDM3Mi4zNCA0MDIuNjEgMzc4LjE5Ii8+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIGQ9Ik0zNzcuODQsMzUxLjcyYy0uMDQsMS4wMy42OSwyLjMxLDEuMTMsMy4yLjM2LjczLDEuNzQsMy4zNSwyLjI2LDMuNjVsMi4zMS0yLjgyLTUuNy00LjAzaDBaIi8+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIGQ9Ik00MjkuNDksMzgzLjhjMy42Ni0uMTYsNy44NC0uOTIsMTEuMzMtMi4zN2wtNi4zLTQuNDUtNS4wNCw2LjgyaC4wMVoiLz4KICAgIDxwYXRoIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgZD0iTTQ0MS43MiwzNjcuMjNsLTUuMjgsNy4xNSw3Ljk1LDUuNjJjMi44OS0xLjAxLDUuODQtMi45NSw4LjEzLTUuMTNsLTEwLjgtNy42NGgwWiIvPgogICAgPHBhdGggZmlsbD0iIzU2YmNiNyIgb3BhY2l0eT0iMC42IiBkPSJNNDE0Ljc0LDM4Mi44MWMxLjc0LjI3LDMuNDcuNzcsNS4yMi45OS45LjExLDIuMzEuMzcsMy4xOCwwbC02LTQuMjUtMi40LDMuMjVoMFoiLz4KICAgIDxwb2x5Z29uIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgcG9pbnRzPSI0MjQuMjcgMzY5LjIyIDQxOC41MiAzNzcuMDIgNDI2LjYxIDM4Mi43NSA0MzIuMzcgMzc0Ljk1IDQyNC4yNyAzNjkuMjIiLz4KICAgIDxwb2x5Z29uIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgcG9pbnRzPSIzODYuMjQgMzU3LjY2IDM4My4xOCAzNjEuODcgMzg5LjQyIDM2OC44MSAzOTMuNzQgMzYyLjk2IDM4Ni4yNCAzNTcuNjYiLz4KICAgIDxwYXRoIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgZD0iTTQzNS45NCwzMDUuNzhjLTIuNTgtMS43Ni01Ljc0LTIuNTctOC42OS0zLjYxbC0yLjg4LDMuODMsNy41LDUuMyw0LjA4LTUuNTJoLS4wMVoiLz4KICAgIDxwYXRoIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgZD0iTTM4Ny43MywzMjkuMDRsLTEwLjUtNy40M2MtMS4zMiwyLjc5LTIuNTQsNi4xNy0yLjQzLDkuMTZsNy42NSw1LjQxLDUuMjgtNy4xNWgwWiIvPgogICAgPHBhdGggZmlsbD0iIzU2YmNiNyIgb3BhY2l0eT0iMC42IiBkPSJNNDUyLjU2LDMyNS45NGMuNTQtMS4wMywyLjk2LTMuMzIsMi43MS00LjI4LS4xOS0uNzItNS42Mi02LjY1LTYuMTMtNi41NWwtNC4wOCw1LjUyLDcuNSw1LjNoMFoiLz4KICAgIDxwb2x5Z29uIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgcG9pbnRzPSI0NjAuOTYgMzMxLjg4IDQ1Ny41OCAzMjUuMDMgNDU1LjI2IDMyNy44NSA0NjAuOTYgMzMxLjg4Ii8+CiAgICA8cG9seWdvbiBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIHBvaW50cz0iNDIzLjgyIDMwMS4xNiA0MTYuMjcgMzAwLjI3IDQyMS42NyAzMDQuMDkgNDIzLjgyIDMwMS4xNiIvPgogICAgPHBhdGggZmlsbD0iIzU2YmNiNyIgb3BhY2l0eT0iMC42IiBkPSJNNDQyLjM3LDMxOC43M2w0LjItNS42OS0uMDktLjgxLTYuNi00LjY3Yy0uMS0uMDctLjc3LjExLS45OS0uMjFsLTQuMzIsNS44NSw3LjgsNS41MmgwWiIvPgogICAgPHBvbHlnb24gZmlsbD0iIzU2YmNiNyIgb3BhY2l0eT0iMC42IiBwb2ludHM9IjQxNC41MyAzMTQuMzcgNDIwLjI5IDMwNi41OCA0MTEuODkgMzAwLjY0IDQwNi4xNCAzMDguNDMgNDE0LjUzIDMxNC4zNyIvPgogICAgPHBhdGggZmlsbD0iIzU2YmNiNyIgb3BhY2l0eT0iMC42IiBkPSJNNDAyLjM2LDMwOS4yMmwtNy42NS01LjQxYy0yLjk3LDEuMTYtNS42NiwzLjA1LTguMTMsNS4xM2wxMC41LDcuNDIsNS4yOC03LjE1aDBaIi8+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBvcGFjaXR5PSIwLjYiIGQ9Ik0zOTQuOTIsMzE5LjI5bC0xMS4xLTcuODVjLTIsMi4yLTMuNjksNC4xNS01LjA0LDYuODJsMTEuMSw3Ljg1LDUuMDQtNi44MloiLz4KICAgIDxwYXRoIGZpbGw9IiM1NmJjYjciIG9wYWNpdHk9IjAuNiIgZD0iTTQwOS4wNywzMDAuMTNjLTMuNjUuMTktNy4yOC45NS0xMC43OSwyLjI1bDYsNC4yNCw0LjgtNi41aC0uMDFaIi8+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBkPSJNNDcyLjg1LDM1NC4zNmMtLjc2LTEuNjYtMy4yNy0uOTMtMy41OSwxLjA2LS43NSw0LjY2LTIuNTUsMTAuNzMtNi43NiwxNi44OS00LjIsNi4xNi05LjIxLDEwLjA1LTEzLjI3LDEyLjQ1LTEuNzMsMS4wMi0xLjUxLDMuNjIuMzIsMy43MywxMi4xMi42OSwyNC4yNSwxLjM3LDM2LjM3LDIuMDYsMS41MS4wOSwyLjc1LTEuNzIsMi4xMi0zLjEtNS4wNi0xMS4wMy0xMC4xMy0yMi4wNS0xNS4xOS0zMy4wOGgwWiIvPgogIDwvZz4KICA8cGF0aCBmaWxsPSIjZWQ2YzZlIiBkPSJNMTI0Mi4zOSwyMTguN2wtLjA0LDM2LjY0Yy05OS4xNS05NS4yNi0yMjMuNjktMTUuODctMjIxLDExMy41NSwyLjU2LDEyMy4yLDEyNi4yNywxOTUuNTksMjIxLDEwNi4wNWwuMDQsMzYuNjQsODguMjYtLjA0VjIxOC43NGwtODguMjYtLjA0aDBaTTEyMjguOTMsMzU5LjE1Yy0xLjIxLDIuNzEtMjQuODgsMjUuNzktMzIuOTcsMzMuOTEtMy41NSwzLjU3LTguODMsNS4yNC0xNS4wMyw0LjQ1LTIuNjQtLjM0LTUuNjYtMS4xMS05LjAyLTIuNTctMTEuNC00Ljk3LTIxLjUzLTUuNzQtMjQuMzEtNS44Ni0uNDMtLjAyLS44MS4zLS44OC43M2gwYy0uMDYuMzYtLjMzLjY1LS42OS43Mi0uNTEuMS0xLjI1LjE5LTEuNzcuMDUtLjgzLS4yMi00LjYzLDMuMTgtNC45NywzLjQ5LS4wMi4wMS0uMDMuMDMtLjA1LjA0bC0xOS4yLDIwLjEyYy0uMTcuMTgtLjI1LjQyLS4yNC42Ni4wNywxLjE5LjExLDQuNzMtMS43OSw0LjM0LTIuMjktLjQ3LTIuOTItLjM4LTUuNDYtMi44OS0xLjgxLTEuNzktMi4zMi0yLjMtMi40Ny0yLjQ1bC0uMDYtLjA2Yy0uMTUtLjE1LS42OC0uNjgtMi40OS0yLjQ3LTIuNDQtMi40Mi0yLjM2LTMuMDYtMi44My01LjMyLS40LTEuODksMy4wMS0yLjAxLDQuMTYtMiwuMjQsMCwuNDctLjA5LjYzLS4yN2wxOS4yMi0yMC4xNXMzLjU2LTQuMjksMy4zMy01LjE1Yy0uMTQtLjUyLS4wNi0xLjI3LjAzLTEuNzkuMDYtLjM1LjMyLS42Mi42Ni0uN2guMDNjLjQxLS4xLjctLjQ4LjY4LS45LS4xNC0yLjc2LS45Ny0xMi44Ni01Ljg4LTI0LjA0LTEuNDQtMy4yOC0yLjIxLTYuMjYtMi41Ni04Ljg5LS44Mi02LjE2Ljc0LTExLjUxLDQuMTQtMTUuMjMsNy43NC04LjQ2LDI5Ljc1LTMzLjE5LDMyLjM0LTM0LjUzLDMuMTEtMS42LDExLjM0LS42MSwxNS44Mi43NCw2Ljk1LDIuMSwyMy4yNywxOCwyNywyMS42OWwuMDIuMDIuMDMuMDNjLjIzLjIzLjUyLjUxLjg0Ljg0bC4wMi4wMi41LjUuMDUuMDUuNTQuNTQuMDguMDhjLjE5LjE5LjM4LjM5LjU4LjU5LjAyLjAyLjA0LjA0LjA2LjA3LjIuMi40LjQxLjYyLjYzbC4wNS4wNWMuMjEuMjIuNDMuNDQuNjUuNjcuMDQuMDQuMDguMDkuMTMuMTMuMjIuMjIuNDQuNDUuNjYuNjguMDUuMDUuMS4xMS4xNi4xNi4yMy4yNC40Ni40OC43LjczLjA0LjA0LjA4LjA5LjEzLjEzLjI0LjI1LjQ5LjUxLjc0Ljc4LjAyLjAyLjA0LjA1LjA2LjA3LjI1LjI2LjUuNTMuNzYuOC4wNC4wNS4wOS4wOS4xMy4xNC4yNS4yNy41MS41NC43Ni44MS4wNi4wNi4xMi4xMi4xNy4xOS4yNi4yNy41MS41NS43Ny44My4wNS4wNi4xMS4xMi4xNi4xOC4yNy4yOS41NC41OC44Ljg0LjAzLjA0LjA2LjA3LjEuMTEuMjYuMjguNTIuNTcuNzguODYuMDQuMDQuMDguMDkuMTIuMTMuMjcuMjkuNTMuNTkuOC44OS4wNi4wNi4xMi4xMy4xNy4yLjI2LjI5LjUyLjU5Ljc4Ljg4LjA2LjA2LjExLjEzLjE3LjE5LjI2LjMuNTMuNi43OS45MS4wNC4wNS4wOC4xLjEzLjE1LjI2LjMuNTIuNi43OC45MS4wMi4wMy4wNC4wNS4wNi4wN2wuNzguOTNjLjA1LjA2LjEuMTIuMTQuMTcuMjUuMy40OS41OS43My44OWwuMTYuMTljLjI0LjMuNDguNTkuNzEuODkuMDQuMDUuMDguMS4xMi4xNi4yNC4zMS40OC42MS43Mi45Mi4wMS4wMi4wMy4wNC4wNC4wNi4yMy4zLjQ1LjU5LjY3Ljg4LjAzLjA0LjA2LjA4LjA5LjEyLjIxLjI5LjQyLjU3LjYyLjg1LjA0LjA1LjA4LjExLjEyLjE2LjIuMjguMzkuNTUuNTcuODIuMDMuMDUuMDcuMS4xLjE1LjE5LjI3LjM3LjU1LjU0LjgxLjAyLjAzLjA0LjA2LjA2LjA5LjE3LjI3LjMzLjUzLjQ5Ljc4LjAxLjAyLjAzLjA0LjA0LjA2LjE2LjI2LjMuNTEuNDQuNzYuMDIuMDQuMDUuMDguMDcuMTIuMTMuMjQuMjUuNDcuMzcuNy4wMi4wNC4wNC4wOC4wNi4xMi4xMS4yMy4yMS40NS4zMS42Ni4wMS4wMy4wMi4wNi4wNC4wOS4wOS4yMi4xOC40NC4yNS42NSwxLjU3LDQuNjQsMi45NSwxMy4xNywxLjUxLDE2LjQxaC4wMywwWiIvPgo8L3N2Zz4=';
const logoSrc = `data:image/svg+xml;base64,${LOGO_BASE64}`;

export const MATCH_OG_SIZE = { width: 1200, height: 630 };
const size = MATCH_OG_SIZE;

/** Link-preview bots hammer share links; the invite route caches every card it
 *  returns and this one is no different. Matches the routes' revalidate = 3600. */
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
};

export async function renderMatchCard(
  match: MatchWithRelations | null,
  locale: string
): Promise<ImageResponse> {
  const t = await getTranslations({ locale, namespace: 'gamesPage' });
  const tMatch = await getTranslations({ locale, namespace: 'matchPage' });
  const {
    poppinsBold: poppinsBoldData,
    poppinsSemiBold: poppinsSemiBoldData,
    interMedium: interMediumData,
  } = await loadOgFonts();

  const fonts = [
    { name: 'Poppins', data: poppinsBoldData, style: 'normal' as const, weight: 700 as const },
    { name: 'Poppins', data: poppinsSemiBoldData, style: 'normal' as const, weight: 600 as const },
    { name: 'Inter', data: interMediumData, style: 'normal' as const, weight: 500 as const },
  ];

  if (!match) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: primary[700],
          fontFamily: 'Poppins',
        }}
      >
        <span style={{ fontSize: 56, fontWeight: 700, color: '#ffffff' }}>Rallia</span>
      </div>,
      { ...size, fonts, headers: CACHE_HEADERS }
    );
  }

  // ---------- Derived values ----------
  const rawSport = match.sport?.name;
  const sportName = rawSport ? rawSport.charAt(0).toUpperCase() + rawSport.slice(1) : 'Match';
  const isPickleball = match.sport?.slug === 'pickleball';
  const facilityName = match.facility?.name;
  const city = match.facility?.city;
  const location = facilityName
    ? `${facilityName}${city ? `, ${city}` : ''}`
    : (match.location_name ?? '');
  const dateObj = new Date(`${match.match_date}T${match.start_time}`);
  // French renders "dimanche 9 août"; only the first letter should go up, so
  // capitalize here instead of letting CSS title-case every word.
  const rawDate = dateObj.toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const dateStr = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  const timeStr = dateObj.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  let endTimeStr = '';
  if (match.end_time) {
    const endObj = new Date(`${match.match_date}T${match.end_time}`);
    endTimeStr = ` – ${endObj.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
  }

  const total = match.format === 'doubles' ? 4 : 2;
  const joined = match.participants?.filter(p => p.status === 'joined') ?? [];
  const joinedCount = joined.length;
  const spotsLeft = Math.max(0, total - joinedCount);
  const isFull = spotsLeft === 0;

  // A registered, uncontested score turns the card into a scoreboard.
  const result = match.result;
  const resultSets = [...(result?.sets ?? [])].sort((a, b) => a.set_number - b.set_number);
  const showResult =
    !!result &&
    !result.disputed &&
    (resultSets.length > 0 || result.team1_score !== null || result.team2_score !== null);

  // Competitive games get a challenge hero; a full or finished game has nobody left to challenge.
  const isCompetitive = match.player_expectation === 'competitive';
  const showChallenge = isCompetitive && !isFull && !showResult;
  const challengeText =
    match.format === 'doubles' ? tMatch('ogChallengeDoubles') : tMatch('ogChallengeSingles');

  const spotsColor = isFull
    ? status.error.dark
    : spotsLeft === 1
      ? status.warning.dark
      : status.success.DEFAULT;
  const spotsBg = isFull ? '#fef2f2' : spotsLeft === 1 ? accent[50] : '#ecfdf5';
  const spotsDot = isFull
    ? status.error.DEFAULT
    : spotsLeft === 1
      ? status.warning.DEFAULT
      : status.success.light;
  const spotsText = isFull ? t('matchFull') : t('spotsLeft', { count: spotsLeft });

  // Sort host first
  const sorted = [...joined].sort((a, b) => (b.is_host ? 1 : 0) - (a.is_host ? 1 : 0));
  const slots = Array.from({ length: total }, (_, i) => {
    const participant = sorted[i];
    return {
      filled: !!participant,
      avatarUrl:
        getStorageImageUrl(participant?.player?.profile?.profile_picture_url, {
          width: 200,
          height: 200,
          quality: 75,
        }) ?? null,
      initials: participant?.player?.profile?.display_name?.charAt(0).toUpperCase() ?? null,
    };
  });
  const filledSlots = slots.filter(s => s.filled);

  // Sides for the scoreboard. team_number predates the assign-on-submit RPC and
  // is still null on older rows, so unknowns fill whichever side has room.
  const perSide = total / 2;
  const sides: (typeof sorted)[] = [[], []];
  const unassigned: typeof sorted = [];
  for (const participant of sorted) {
    if (participant.team_number === 1 || participant.team_number === 2) {
      sides[participant.team_number - 1].push(participant);
    } else {
      unassigned.push(participant);
    }
  }
  for (const participant of unassigned) {
    sides[sides[0].length < perSide ? 0 : 1].push(participant);
  }

  const sideLabel = (members: typeof sorted, index: number) => {
    const names = members
      .map(m => m.player?.profile?.display_name?.trim())
      .filter((n): n is string => !!n);
    if (names.length === 0) return tMatch('ogTeamFallback', { number: index + 1 });
    const label = (names.length > 1 ? names.map(n => n.split(/[\s_]+/)[0]) : names).join(' & ');
    const limit = names.length > 1 ? 22 : 26;
    return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
  };

  const scoreRows = sides.map((members, index) => ({
    label: sideLabel(members, index),
    won: result?.winning_team === index + 1,
    avatars: members.map(m => ({
      avatarUrl:
        getStorageImageUrl(m.player?.profile?.profile_picture_url, {
          width: 200,
          height: 200,
          quality: 75,
        }) ?? null,
      initials: m.player?.profile?.display_name?.charAt(0).toUpperCase() ?? null,
    })),
    // Per-set games when they were registered, otherwise the sets-won tally.
    scores:
      resultSets.length > 0
        ? resultSets.map(set => ({
            value: index === 0 ? set.team1_score : set.team2_score,
            tookIt:
              index === 0 ? set.team1_score > set.team2_score : set.team2_score > set.team1_score,
          }))
        : [
            {
              value: (index === 0 ? result?.team1_score : result?.team2_score) ?? 0,
              tookIt: result?.winning_team === index + 1,
            },
          ],
  }));

  // Build attribute badges
  const attributes: { label: string; highlight?: boolean }[] = [];
  attributes.push({ label: match.format === 'doubles' ? t('doubles') : t('singles') });
  if (match.player_expectation && match.player_expectation !== 'both') {
    attributes.push({
      label: isCompetitive ? t('competitive') : t('casual'),
      highlight: isCompetitive,
    });
  }
  if (match.min_rating_score) {
    attributes.push({ label: match.min_rating_score.label });
  }
  if (match.court_status === 'reserved') {
    attributes.push({ label: t('courtBooked') });
  }
  if (match.is_court_free) {
    attributes.push({ label: t('free') });
  } else if (match.estimated_cost) {
    attributes.push({
      label: t('costPerPlayer', { amount: (match.estimated_cost / total).toFixed(2) }),
    });
  }

  // ---------- Shared chrome ----------

  // Faint sport-accurate court lines: tennis gets service boxes, pickleball
  // gets the kitchen. Sits behind the content, cropped by the right edge.
  const courtArt = (
    <div
      style={{
        position: 'absolute',
        top: isPickleball ? 200 : 140,
        right: isPickleball ? -110 : -230,
        display: 'flex',
        opacity: 0.09,
        transform: 'rotate(-9deg)',
      }}
    >
      {isPickleball ? (
        <svg width="700" height="318" viewBox="0 0 440 200" fill="none">
          <rect x="2" y="2" width="436" height="196" stroke="#ffffff" strokeWidth="3" />
          <line x1="150" y1="2" x2="150" y2="198" stroke="#ffffff" strokeWidth="2" />
          <line x1="290" y1="2" x2="290" y2="198" stroke="#ffffff" strokeWidth="2" />
          <line x1="2" y1="100" x2="150" y2="100" stroke="#ffffff" strokeWidth="2" />
          <line x1="290" y1="100" x2="438" y2="100" stroke="#ffffff" strokeWidth="2" />
          <line x1="220" y1="0" x2="220" y2="200" stroke="#ffffff" strokeWidth="4" />
        </svg>
      ) : (
        <svg width="880" height="406" viewBox="0 0 780 360" fill="none">
          <rect x="3" y="3" width="774" height="354" stroke="#ffffff" strokeWidth="4" />
          <line x1="3" y1="48" x2="777" y2="48" stroke="#ffffff" strokeWidth="3" />
          <line x1="3" y1="312" x2="777" y2="312" stroke="#ffffff" strokeWidth="3" />
          <line x1="180" y1="48" x2="180" y2="312" stroke="#ffffff" strokeWidth="3" />
          <line x1="600" y1="48" x2="600" y2="312" stroke="#ffffff" strokeWidth="3" />
          <line x1="180" y1="180" x2="600" y2="180" stroke="#ffffff" strokeWidth="3" />
          <line x1="3" y1="180" x2="20" y2="180" stroke="#ffffff" strokeWidth="3" />
          <line x1="760" y1="180" x2="777" y2="180" stroke="#ffffff" strokeWidth="3" />
          <line x1="390" y1="0" x2="390" y2="360" stroke="#ffffff" strokeWidth="6" />
        </svg>
      )}
    </div>
  );

  // Soft light source: gold for the challenge, teal otherwise.
  const glow = (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        background: showChallenge
          ? 'radial-gradient(circle at 78% 42%, rgba(245,181,53,0.18), rgba(245,181,53,0) 55%)'
          : 'radial-gradient(circle at 72% 30%, rgba(23,201,180,0.16), rgba(23,201,180,0) 60%)',
      }}
    />
  );

  const eyebrowLabel = showChallenge ? `${sportName} · ${t('competitive')}` : sportName;

  const locationRow = location ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke={primary[100]}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      <span style={{ fontSize: 25, fontWeight: 500, color: neutral[200] }}>{location}</span>
    </div>
  ) : null;

  const badgesRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {attributes.map((attr, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '7px 18px',
            borderRadius: 10,
            background: attr.highlight ? 'rgba(245,181,53,0.16)' : 'rgba(0,0,0,0.18)',
            border: attr.highlight
              ? '1px solid rgba(245,181,53,0.45)'
              : '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <span
            style={{
              fontSize: 17,
              fontWeight: 500,
              color: attr.highlight ? accent[200] : primary[100],
            }}
          >
            {attr.label}
          </span>
        </div>
      ))}
    </div>
  );

  const spotsPill = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 26px',
        borderRadius: 100,
        background: spotsBg,
      }}
    >
      <div style={{ width: 10, height: 10, borderRadius: 5, background: spotsDot }} />
      <span style={{ fontFamily: 'Poppins', fontSize: 19, fontWeight: 600, color: spotsColor }}>
        {spotsText}
      </span>
    </div>
  );

  const avatarCircle = (
    slot: { avatarUrl: string | null; initials: string | null },
    px: number,
    ring: string,
    overlap: boolean,
    key: number,
    glowRing?: boolean
  ) => (
    <div
      key={key}
      style={{
        width: px,
        height: px,
        borderRadius: px / 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        marginLeft: overlap ? -Math.round(px * 0.24) : 0,
        background: slot.avatarUrl ? primary[700] : primary[500],
        border: ring,
        ...(glowRing ? { boxShadow: '0 0 70px rgba(245,181,53,0.4)' } : {}),
      }}
    >
      {slot.avatarUrl ? (
        <img
          src={slot.avatarUrl}
          width={px}
          height={px}
          style={{ objectFit: 'cover', width: px, height: px }}
        />
      ) : (
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: Math.round(px * 0.36),
            fontWeight: 700,
            color: '#ffffff',
          }}
        >
          {slot.initials}
        </span>
      )}
    </div>
  );

  // ---------- Variant content ----------

  let content;
  if (showResult) {
    // Broadcast-style score bug: one table, aligned set columns, gold winner row.
    content = (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          gap: 24,
        }}
      >
        <div style={{ display: 'flex' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 20px',
              borderRadius: 999,
              border: '1px solid rgba(245,181,53,0.5)',
              background: 'rgba(245,181,53,0.1)',
            }}
          >
            <span
              style={{
                fontFamily: 'Poppins',
                fontSize: 16,
                fontWeight: 600,
                color: accent[300],
                textTransform: 'uppercase',
                letterSpacing: '0.16em',
              }}
            >
              {tMatch('ogFinalScore')}
            </span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 10,
            borderRadius: 22,
            background: 'rgba(0,0,0,0.18)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {scoreRows.map((row, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                padding: '18px 26px',
                borderRadius: 14,
                background: row.won ? 'rgba(245,181,53,0.12)' : 'rgba(255,255,255,0.03)',
                borderLeft: row.won
                  ? `6px solid ${accent[400]}`
                  : '6px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {row.avatars.map((avatar, j) =>
                  avatarCircle(
                    avatar,
                    58,
                    row.won ? '3px solid rgba(245,181,53,0.55)' : '3px solid rgba(15,118,110,0.6)',
                    j > 0,
                    j
                  )
                )}
              </div>
              <span
                style={{
                  fontFamily: 'Poppins',
                  fontSize: 31,
                  fontWeight: 700,
                  color: row.won ? '#ffffff' : primary[200],
                }}
              >
                {row.label}
              </span>
              {row.won && (
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={accent[300]}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                  <path d="M4 22h16" />
                  <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                  <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                  <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                </svg>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
                {row.scores.map((score, j) => (
                  <div
                    key={j}
                    style={{
                      width: 62,
                      height: 62,
                      borderRadius: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: score.tookIt ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.25)',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'Poppins',
                        fontSize: 32,
                        fontWeight: 700,
                        color: score.tookIt ? '#ffffff' : primary[300],
                      }}
                    >
                      {score.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 22, fontWeight: 500, color: primary[200] }}>{dateStr}</span>
          {location && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.35)',
                }}
              />
              <span style={{ fontSize: 22, fontWeight: 500, color: neutral[200] }}>{location}</span>
            </div>
          )}
        </div>
      </div>
    );
  } else if (showChallenge) {
    // Fight poster: message stack on the left, the duel on the right. The
    // dashed circle is the open spot the viewer is being dared to take.
    const duelSize = match.format === 'doubles' ? 104 : 160;
    const shownFilled = filledSlots.slice(0, 2);
    const emptyCount = Math.min(spotsLeft, 2);
    content = (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flex: 1,
          gap: 30,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: 640 }}>
          <span
            style={{
              fontFamily: 'Poppins',
              fontSize: 60,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.08,
            }}
          >
            {challengeText}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontFamily: 'Poppins',
                fontSize: 29,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.94)',
              }}
            >
              {dateStr}
            </span>
            <span style={{ fontSize: 24, fontWeight: 500, color: primary[200] }}>
              {timeStr}
              {endTimeStr}
            </span>
          </div>
          {locationRow}
          {badgesRow}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
            marginLeft: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {shownFilled.map((slot, i) =>
                avatarCircle(slot, duelSize, `4px solid ${accent[400]}`, i > 0, i, true)
              )}
            </div>
            <span
              style={{
                fontFamily: 'Poppins',
                fontSize: 30,
                fontWeight: 700,
                color: accent[300],
                letterSpacing: '0.06em',
              }}
            >
              VS
            </span>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {Array.from({ length: emptyCount }, (_, i) => (
                <div
                  key={i}
                  style={{
                    width: duelSize,
                    height: duelSize,
                    borderRadius: duelSize / 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: i === 0 ? 0 : -Math.round(duelSize * 0.24),
                    background: 'rgba(0,0,0,0.16)',
                    border: '3px dashed rgba(255,255,255,0.4)',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'Poppins',
                      fontSize: Math.round(duelSize * 0.38),
                      fontWeight: 700,
                      color: 'rgba(255,255,255,0.4)',
                    }}
                  >
                    ?
                  </span>
                </div>
              ))}
            </div>
          </div>
          {spotsPill}
        </div>
      </div>
    );
  } else {
    // Upcoming game: date-led poster, spots pill closing the story.
    content = (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span
            style={{
              fontFamily: 'Poppins',
              fontSize: 58,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.1,
            }}
          >
            {dateStr}
          </span>
          <span style={{ fontSize: 30, fontWeight: 500, color: primary[200] }}>
            {timeStr}
            {endTimeStr}
          </span>
        </div>
        {locationRow}
        {badgesRow}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {slots.map((slot, i) =>
              slot.filled ? (
                avatarCircle(slot, 64, '3px solid rgba(15,118,110,0.6)', i > 0, i)
              ) : (
                <div
                  key={i}
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: i === 0 ? 0 : -15,
                    background: 'rgba(255,255,255,0.06)',
                    border: '2px solid rgba(255,255,255,0.18)',
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="rgba(255,255,255,0.35)"
                    strokeWidth="2"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
              )
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 20 }}>
            <span
              style={{
                fontFamily: 'Poppins',
                fontSize: 28,
                fontWeight: 700,
                color: '#ffffff',
                lineHeight: 1,
              }}
            >
              {joinedCount}/{total}
            </span>
            <span style={{ fontSize: 16, fontWeight: 500, color: primary[100] }}>
              {t('playersJoined')}
            </span>
          </div>
          <div style={{ display: 'flex', marginLeft: 'auto' }}>{spotsPill}</div>
        </div>
      </div>
    );
  }

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(150deg, ${primary[900]} 0%, ${primary[700]} 50%, ${primary[500]} 100%)`,
        fontFamily: 'Inter',
        padding: '0 56px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Accent gradient bar at very top */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 5,
          display: 'flex',
          background: 'linear-gradient(90deg, #6bdcc9, #f5b535, #f2554b)',
        }}
      />

      {glow}
      {courtArt}

      {/* Top bar: Sport + Rallia */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 36,
          paddingBottom: 12,
        }}
      >
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: 20,
            fontWeight: 600,
            color: showChallenge ? accent[300] : primary[200],
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
          }}
        >
          {eyebrowLabel}
        </span>
        <img src={logoSrc} height={40} style={{ height: 40, objectFit: 'contain' }} />
      </div>

      {content}

      {/* Bottom branding */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 14,
          paddingBottom: 22,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.35)' }}>
          rallia.app
        </span>
      </div>
    </div>,
    { ...size, fonts, headers: CACHE_HEADERS }
  );
}
