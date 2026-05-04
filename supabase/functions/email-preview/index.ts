/**
 * Email Preview Gallery
 * Renders all email templates with mock data for visual testing.
 *
 * Usage:
 *   supabase functions serve --no-verify-jwt
 *   open http://localhost:54321/functions/v1/email-preview
 */

import { generateEmailHtml } from '../send-notification/templates/match.ts';
import { renderOrgEmail } from '../send-notification/templates/organization.ts';
import { renderInvitationEmail } from '../send-email/templates/invitation.ts';
import { renderNotificationEmail } from '../send-email/templates/notification.ts';
import { renderMatchInterestEmail } from '../send-email/templates/match-interest.ts';
import { renderWelcomeEmail } from '../send-email/templates/welcome.ts';
import { renderMorningDigestEmail } from '../send-morning-digest/template.ts';
import type { NotificationRecord, OrganizationInfo } from '../send-notification/types.ts';
import type {
  InvitationEmailPayload,
  NotificationEmailPayload,
  WelcomeEmailPayload,
} from '../send-email/types.ts';

// Auth templates inlined as string constants — file reading doesn't work in the
// compiled Deno edge runtime since it runs from /var/tmp/sb-compile-edge-runtime/
const CONFIRMATION_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Rallia - Verification Code</title>
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap"
      rel="stylesheet"
    />
    <!--[if mso]>
      <style type="text/css">
        body,
        table,
        td {
          font-family: Arial, sans-serif !important;
        }
      </style>
    <![endif]-->
    <style type="text/css">
      @media (prefers-color-scheme: dark) {
        .email-body { background-color: #1a1a1a !important; }
        .email-container { background-color: #262626 !important; }
        .email-header { background-color: #0f766e !important; }
        .email-content { background-color: #262626 !important; }
        .email-footer { background-color: #1f1f1f !important; border-top-color: #404040 !important; }
        .email-text { color: #e5e5e5 !important; }
        .email-muted { color: #a3a3a3 !important; }
        .email-otp-box { background-color: #1a2e2b !important; border-color: #2d4a46 !important; }
        .email-divider { border-top-color: #404040 !important; }
        .email-content h2 { color: #5eead4 !important; }
        .email-content p { color: #e5e5e5 !important; }
        .email-content a { color: #5eead4 !important; }
        .email-footer p { color: #a3a3a3 !important; }
        .email-footer a { color: #5eead4 !important; }
      }
      [data-ogsc] .email-body { background-color: #1a1a1a !important; }
      [data-ogsc] .email-container { background-color: #262626 !important; }
      [data-ogsc] .email-header { background-color: #0f766e !important; }
      [data-ogsc] .email-footer { background-color: #1f1f1f !important; }
      [data-ogsc] .email-text { color: #e5e5e5 !important; }
      [data-ogsc] .email-muted { color: #a3a3a3 !important; }
      [data-ogsc] .email-content h2 { color: #5eead4 !important; }
      [data-ogsc] .email-content p { color: #e5e5e5 !important; }
      [data-ogsc] .email-footer p { color: #a3a3a3 !important; }
    </style>
  </head>
  <body style="margin: 0; padding: 0">
    <!-- Preheader -->
    <span style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">{{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Votre code de vérification Rallia est à l'intérieur{{ else }}Your Rallia verification code is inside{{ end }}</span>
    <table
      role="presentation"
      cellspacing="0"
      cellpadding="0"
      border="0"
      width="100%"
      class="email-body"
      style="background-color: #f0fdfa; font-family: Inter, Arial, Helvetica, sans-serif"
    >
      <tr>
        <td align="center" style="padding: 40px 20px">
          <table
            role="presentation"
            cellspacing="0"
            cellpadding="0"
            border="0"
            width="600"
            class="email-container"
            style="background-color: #ffffff; border-radius: 12px; overflow: hidden"
          >
            <!-- Header -->
            <tr>
              <td
                align="center"
                class="email-header"
                style="
                  padding: 40px 40px 20px 40px;
                  background-color: #0d9488;
                  border-radius: 12px 12px 0 0;
                "
              >
                <img
                  src="{{ .SiteURL }}/logo-light.png"
                  alt="Rallia"
                  width="140"
                  height="55"
                  style="display: block; border: 0; max-width: 140px; height: auto"
                />
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td class="email-content" style="padding: 40px 40px 30px 40px">
                <h2
                  style="
                    padding: 0 0 16px 0;
                    font-family: Poppins, Arial, Helvetica, sans-serif;
                    font-size: 24px;
                    font-weight: bold;
                    color: #0d9488;
                    letter-spacing: -0.025em;
                    line-height: 1.2;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Code de connexion à usage unique{{ else }}One-time login code{{ end }}
                </h2>

                <p
                  class="email-text"
                  style="
                    padding: 0 0 32px 0;
                    font-size: 16px;
                    line-height: 1.6;
                    color: #171717;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Bienvenue sur Rallia ! Utilisez le code ci-dessous pour terminer votre connexion et commencer.{{ else }}Welcome to Rallia! Use the verification code below to complete your sign-in and get started.{{ end }}
                </p>

                <!-- OTP Code Box -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  width="100%"
                >
                  <tr>
                    <td align="center" style="padding: 0 0 24px 0">
                      <table
                        role="presentation"
                        cellspacing="0"
                        cellpadding="0"
                        border="0"
                        class="email-otp-box"
                        style="
                          background-color: #f0fdfa;
                          border: 1px solid #ccfbf1;
                          border-radius: 8px;
                        "
                      >
                        <tr>
                          <td align="center" style="padding: 32px 40px">
                            <p
                              style="
                                padding: 0 0 8px 0;
                                font-size: 14px;
                                font-weight: bold;
                                color: #0d9488;
                                text-transform: uppercase;
                                letter-spacing: 0.05em;
                              "
                            >
                              {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Votre code de vérification{{ else }}Your Verification Code{{ end }}
                            </p>
                            <p
                              style="
                                padding: 0;
                                font-family: Poppins, Arial, Helvetica, sans-serif;
                                font-size: 36px;
                                font-weight: bold;
                                color: #0d9488;
                                letter-spacing: 0.2em;
                                line-height: 1.2;
                              "
                            >
                              {{ .Token }}
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <p
                  class="email-muted"
                  style="
                    padding: 0 0 24px 0;
                    font-size: 14px;
                    line-height: 1.6;
                    color: #525252;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Entrez ce code dans le formulaire de connexion pour vérifier votre courriel. Ce code expire dans 10 minutes.{{ else }}Enter this code in the sign-in form to verify your email address. This code will expire in 10 minutes.{{ end }}
                </p>

                <!-- Divider -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  width="100%"
                >
                  <tr>
                    <td class="email-divider" style="padding: 16px 0; border-top: 1px solid #e5e5e5"></td>
                  </tr>
                </table>

                <p
                  class="email-muted"
                  style="
                    padding: 0;
                    font-size: 13px;
                    line-height: 1.5;
                    color: #737373;
                    text-align: center;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce courriel. Votre compte reste sécurisé.{{ else }}If you didn't request this code, you can safely ignore this email. Your account remains secure.{{ end }}
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td
                align="center"
                class="email-footer"
                style="
                  padding: 30px 40px 40px 40px;
                  background-color: #fafafa;
                  border-top: 1px solid #e5e5e5;
                  border-radius: 0 0 12px 12px;
                "
              >
                <p
                  style="
                    padding: 0 0 8px 0;
                    font-size: 14px;
                    font-weight: bold;
                    color: #0d9488;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Besoin d'aide ?{{ else }}Need help?{{ end }}
                </p>
                <p
                  class="email-muted"
                  style="
                    padding: 0;
                    font-size: 13px;
                    line-height: 1.5;
                    color: #525252;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}En cas de problème, contactez-nous à <a href="mailto:contact@rallia.ca" style="color: #0d9488; text-decoration: none;">contact@rallia.ca</a>{{ else }}If you're having trouble, contact us at <a href="mailto:contact@rallia.ca" style="color: #0d9488; text-decoration: none;">contact@rallia.ca</a>{{ end }}
                </p>
                <!-- App Store Badges -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding: 16px 0 0 0;">
                      <p style="margin: 0; padding: 0 0 12px 0; font-size: 13px; font-weight: 600; color: #0d9488;">{{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Téléchargez l'application{{ else }}Download the app{{ end }}</p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding: 0 6px 0 0;">
                            <a href="https://apps.apple.com/app/rallia/id6760482014" style="text-decoration: none;">
                              <img src="{{ .SiteURL }}/app-store-badge.svg" alt="{{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Télécharger dans l'App Store{{ else }}Download on the App Store{{ end }}" width="120" height="40" style="display: block; border: 0;" />
                            </a>
                          </td>
                          <td style="padding: 0 0 0 6px;">
                            <a href="https://play.google.com/store/apps/details?id=com.mathisl971.ralliaapp" style="text-decoration: none;">
                              <img src="{{ .SiteURL }}/google-play-badge.svg" alt="{{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Disponible sur Google Play{{ else }}Get it on Google Play{{ end }}" width="135" height="40" style="display: block; border: 0;" />
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <p
                  class="email-muted"
                  style="
                    padding: 16px 0 0 0;
                    font-size: 12px;
                    line-height: 1.5;
                    color: #737373;
                  "
                >
                  &copy; Rallia. {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Tous droits réservés.{{ else }}All rights reserved.{{ end }}
                </p>
              </td>
            </tr>
          </table>

          <!-- Spacer -->
          <table
            role="presentation"
            cellspacing="0"
            cellpadding="0"
            border="0"
            width="100%"
          >
            <tr>
              <td align="center" style="padding: 20px 0">
                <p
                  class="email-muted"
                  style="
                    padding: 0;
                    font-size: 12px;
                    line-height: 1.5;
                    color: #737373;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Vous recevez ce courriel car vous vous êtes inscrit sur Rallia.{{ else }}You're receiving this email because you signed up for Rallia.{{ end }}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const MAGIC_LINK_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Rallia - Verification Code</title>
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap"
      rel="stylesheet"
    />
    <!--[if mso]>
      <style type="text/css">
        body,
        table,
        td {
          font-family: Arial, sans-serif !important;
        }
      </style>
    <![endif]-->
    <style type="text/css">
      @media (prefers-color-scheme: dark) {
        .email-body { background-color: #1a1a1a !important; }
        .email-container { background-color: #262626 !important; }
        .email-header { background-color: #0f766e !important; }
        .email-content { background-color: #262626 !important; }
        .email-footer { background-color: #1f1f1f !important; border-top-color: #404040 !important; }
        .email-text { color: #e5e5e5 !important; }
        .email-muted { color: #a3a3a3 !important; }
        .email-otp-box { background-color: #1a2e2b !important; border-color: #2d4a46 !important; }
        .email-divider { border-top-color: #404040 !important; }
        .email-content h2 { color: #5eead4 !important; }
        .email-content p { color: #e5e5e5 !important; }
        .email-content a { color: #5eead4 !important; }
        .email-footer p { color: #a3a3a3 !important; }
        .email-footer a { color: #5eead4 !important; }
      }
      [data-ogsc] .email-body { background-color: #1a1a1a !important; }
      [data-ogsc] .email-container { background-color: #262626 !important; }
      [data-ogsc] .email-header { background-color: #0f766e !important; }
      [data-ogsc] .email-footer { background-color: #1f1f1f !important; }
      [data-ogsc] .email-text { color: #e5e5e5 !important; }
      [data-ogsc] .email-muted { color: #a3a3a3 !important; }
      [data-ogsc] .email-content h2 { color: #5eead4 !important; }
      [data-ogsc] .email-content p { color: #e5e5e5 !important; }
      [data-ogsc] .email-footer p { color: #a3a3a3 !important; }
    </style>
  </head>
  <body style="margin: 0; padding: 0">
    <!-- Preheader -->
    <span style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">{{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Votre code de connexion à usage unique pour Rallia{{ else }}Your one-time login code for Rallia{{ end }}</span>
    <table
      role="presentation"
      cellspacing="0"
      cellpadding="0"
      border="0"
      width="100%"
      class="email-body"
      style="background-color: #f0fdfa; font-family: Inter, Arial, Helvetica, sans-serif"
    >
      <tr>
        <td align="center" style="padding: 40px 20px">
          <table
            role="presentation"
            cellspacing="0"
            cellpadding="0"
            border="0"
            width="600"
            class="email-container"
            style="background-color: #ffffff; border-radius: 12px; overflow: hidden"
          >
            <!-- Header -->
            <tr>
              <td
                align="center"
                class="email-header"
                style="
                  padding: 40px 40px 20px 40px;
                  background-color: #0d9488;
                  border-radius: 12px 12px 0 0;
                "
              >
                <img
                  src="{{ .SiteURL }}/logo-light.png"
                  alt="Rallia"
                  width="140"
                  height="55"
                  style="display: block; border: 0; max-width: 140px; height: auto"
                />
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td class="email-content" style="padding: 40px 40px 30px 40px">
                <h2
                  style="
                    padding: 0 0 16px 0;
                    font-family: Poppins, Arial, Helvetica, sans-serif;
                    font-size: 24px;
                    font-weight: bold;
                    color: #0d9488;
                    letter-spacing: -0.025em;
                    line-height: 1.2;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Code de connexion à usage unique{{ else }}One-time login code{{ end }}
                </h2>

                <p
                  class="email-text"
                  style="
                    padding: 0 0 32px 0;
                    font-size: 16px;
                    line-height: 1.6;
                    color: #171717;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Utilisez le code ci-dessous pour vous connecter à votre compte.{{ else }}Use the verification code below to sign in to your account.{{ end }}
                </p>

                <!-- OTP Code Box -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  width="100%"
                >
                  <tr>
                    <td align="center" style="padding: 0 0 24px 0">
                      <table
                        role="presentation"
                        cellspacing="0"
                        cellpadding="0"
                        border="0"
                        class="email-otp-box"
                        style="
                          background-color: #f0fdfa;
                          border: 1px solid #ccfbf1;
                          border-radius: 8px;
                        "
                      >
                        <tr>
                          <td align="center" style="padding: 32px 40px">
                            <p
                              style="
                                padding: 0 0 8px 0;
                                font-size: 14px;
                                font-weight: bold;
                                color: #0d9488;
                                text-transform: uppercase;
                                letter-spacing: 0.05em;
                              "
                            >
                              {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Votre code de vérification{{ else }}Your Verification Code{{ end }}
                            </p>
                            <p
                              style="
                                padding: 0;
                                font-family: Poppins, Arial, Helvetica, sans-serif;
                                font-size: 36px;
                                font-weight: bold;
                                color: #0d9488;
                                letter-spacing: 0.2em;
                                line-height: 1.2;
                              "
                            >
                              {{ .Token }}
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <p
                  class="email-muted"
                  style="
                    padding: 0 0 24px 0;
                    font-size: 14px;
                    line-height: 1.6;
                    color: #525252;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Entrez ce code dans le formulaire de connexion pour vérifier votre courriel. Ce code expire dans 10 minutes.{{ else }}Enter this code in the sign-in form to verify your email address. This code will expire in 10 minutes.{{ end }}
                </p>

                <!-- Divider -->
                <table
                  role="presentation"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  width="100%"
                >
                  <tr>
                    <td class="email-divider" style="padding: 16px 0; border-top: 1px solid #e5e5e5"></td>
                  </tr>
                </table>

                <p
                  class="email-muted"
                  style="
                    padding: 0;
                    font-size: 13px;
                    line-height: 1.5;
                    color: #737373;
                    text-align: center;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce courriel. Votre compte reste sécurisé.{{ else }}If you didn't request this code, you can safely ignore this email. Your account remains secure.{{ end }}
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td
                align="center"
                class="email-footer"
                style="
                  padding: 30px 40px 40px 40px;
                  background-color: #fafafa;
                  border-top: 1px solid #e5e5e5;
                  border-radius: 0 0 12px 12px;
                "
              >
                <p
                  style="
                    padding: 0 0 8px 0;
                    font-size: 14px;
                    font-weight: bold;
                    color: #0d9488;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Besoin d'aide ?{{ else }}Need help?{{ end }}
                </p>
                <p
                  class="email-muted"
                  style="
                    padding: 0;
                    font-size: 13px;
                    line-height: 1.5;
                    color: #525252;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}En cas de problème, contactez-nous à <a href="mailto:contact@rallia.ca" style="color: #0d9488; text-decoration: none;">contact@rallia.ca</a>{{ else }}If you're having trouble, contact us at <a href="mailto:contact@rallia.ca" style="color: #0d9488; text-decoration: none;">contact@rallia.ca</a>{{ end }}
                </p>
                <!-- App Store Badges -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding: 16px 0 0 0;">
                      <p style="margin: 0; padding: 0 0 12px 0; font-size: 13px; font-weight: 600; color: #0d9488;">{{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Téléchargez l'application{{ else }}Download the app{{ end }}</p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding: 0 6px 0 0;">
                            <a href="https://apps.apple.com/app/rallia/id6760482014" style="text-decoration: none;">
                              <img src="{{ .SiteURL }}/app-store-badge.svg" alt="{{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Télécharger dans l'App Store{{ else }}Download on the App Store{{ end }}" width="120" height="40" style="display: block; border: 0;" />
                            </a>
                          </td>
                          <td style="padding: 0 0 0 6px;">
                            <a href="https://play.google.com/store/apps/details?id=com.mathisl971.ralliaapp" style="text-decoration: none;">
                              <img src="{{ .SiteURL }}/google-play-badge.svg" alt="{{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Disponible sur Google Play{{ else }}Get it on Google Play{{ end }}" width="135" height="40" style="display: block; border: 0;" />
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <p
                  class="email-muted"
                  style="
                    padding: 16px 0 0 0;
                    font-size: 12px;
                    line-height: 1.5;
                    color: #737373;
                  "
                >
                  &copy; Rallia. {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Tous droits réservés.{{ else }}All rights reserved.{{ end }}
                </p>
              </td>
            </tr>
          </table>

          <!-- Spacer -->
          <table
            role="presentation"
            cellspacing="0"
            cellpadding="0"
            border="0"
            width="100%"
          >
            <tr>
              <td align="center" style="padding: 20px 0">
                <p
                  class="email-muted"
                  style="
                    padding: 0;
                    font-size: 12px;
                    line-height: 1.5;
                    color: #737373;
                  "
                >
                  {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}Vous recevez ce courriel car vous vous êtes inscrit sur Rallia.{{ else }}You're receiving this email because you signed up for Rallia.{{ end }}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const TOMORROW = new Date(Date.now() + 86400000);
const MATCH_DATE = TOMORROW.toISOString().slice(0, 10); // YYYY-MM-DD

const MOCK_MATCH_PAYLOAD: Record<string, unknown> = {
  matchId: 'match-abc-123',
  sportName: 'Tennis',
  matchDate: MATCH_DATE,
  startTime: '14:00',
  matchDurationMinutes: 60,
  locationName: 'Parc La Fontaine',
  locationAddress: '3933 Av du Parc La Fontaine, Montreal, QC H2L 3M6',
  latitude: 45.5017,
  longitude: -73.5673,
  playerName: 'Alex Johnson',
  playerAvatarUrl: 'https://i.pravatar.cc/64?u=test',
};

const MOCK_ORG: OrganizationInfo = {
  id: 'org-123',
  name: 'Montreal Tennis Club',
  email: 'org@tennis.ca',
  website: 'https://montrealtennis.ca',
};

function mockNotification(
  type: string,
  title: string,
  body: string | null,
  payloadOverrides: Record<string, unknown> = {}
): NotificationRecord {
  return {
    id: `notif-${type}`,
    user_id: 'user-mock-001',
    type: type as NotificationRecord['type'],
    target_id: null,
    title,
    body,
    payload: { ...MOCK_MATCH_PAYLOAD, ...payloadOverrides },
    priority: 'normal',
    scheduled_at: null,
    expires_at: null,
    read_at: null,
    organization_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

const PREVIEW_SITE_URL = 'http://localhost:3000';

interface TemplateOverrides {
  title?: string;
  body?: string;
}

interface TemplateEntry {
  id: string;
  label: string;
  category: string;
  render: (locale: string, overrides?: TemplateOverrides) => string;
}

function renderAuthTemplate(templateFile: string, locale: string): string {
  const isFr = locale.startsWith('fr');
  const siteUrl = PREVIEW_SITE_URL;

  let html = templateFile === 'confirmation.html' ? CONFIRMATION_HTML : MAGIC_LINK_HTML;

  // Replace Go template variables
  html = html.replace(/\{\{\s*\.Token\s*\}\}/g, '847291');
  html = html.replace(/\{\{\s*\.SiteURL\s*\}\}/g, siteUrl);

  // Handle locale conditionals: {{ if or (eq .Data.locale "fr") (eq .Data.locale "fr-CA") }}FR{{ else }}EN{{ end }}
  html = html.replace(
    /\{\{\s*if\s+or\s+\(eq\s+\.Data\.locale\s+"fr"\)\s+\(eq\s+\.Data\.locale\s+"fr-CA"\)\s*\}\}([\s\S]*?)\{\{\s*else\s*\}\}([\s\S]*?)\{\{\s*end\s*\}\}/g,
    (_match, frBranch, enBranch) => (isFr ? frBranch : enBranch)
  );

  return html;
}

const TEMPLATES: TemplateEntry[] = [
  // ---- Auth ----
  {
    id: 'auth_confirmation',
    label: 'Auth: Confirmation',
    category: 'Auth',
    render: locale => renderAuthTemplate('confirmation.html', locale),
  },
  {
    id: 'auth_magic_link',
    label: 'Auth: Magic Link',
    category: 'Auth',
    render: locale => renderAuthTemplate('magic_link.html', locale),
  },

  // ---- Invitation ----
  {
    id: 'invitation_org',
    label: 'Invitation: Org',
    category: 'Invitation',
    render: locale => {
      const payload: InvitationEmailPayload = {
        type: 'invitation',
        email: 'player@example.com',
        role: 'organization_member',
        signUpUrl: 'http://localhost:3000/invite?token=abc123',
        inviterName: 'Marie Dupont',
        expiresAt: new Date(Date.now() + 7 * 86400000).toLocaleDateString(locale),
        organizationName: 'Montreal Tennis Club',
        orgRole: 'Member',
      };
      return renderInvitationEmail(payload, locale, PREVIEW_SITE_URL).html;
    },
  },
  {
    id: 'invitation_platform',
    label: 'Invitation: Platform',
    category: 'Invitation',
    render: locale => {
      const payload: InvitationEmailPayload = {
        type: 'invitation',
        email: 'friend@example.com',
        role: 'player',
        signUpUrl: 'http://localhost:3000/invite?token=xyz789',
        inviterName: 'Marc Tremblay',
        expiresAt: new Date(Date.now() + 7 * 86400000).toLocaleDateString(locale),
      };
      return renderInvitationEmail(payload, locale, PREVIEW_SITE_URL).html;
    },
  },

  // ---- Notification (generic) ----
  {
    id: 'notification_generic',
    label: 'Notification: Generic',
    category: 'Notification',
    render: (locale, overrides) => {
      const payload: NotificationEmailPayload = {
        type: 'notification',
        email: 'user@example.com',
        notificationType: 'system',
        title: overrides?.title ?? 'System Maintenance Scheduled',
        body:
          overrides?.body ??
          'We will be performing scheduled maintenance on March 15 from 2:00 AM to 4:00 AM EST. During this time, some features may be temporarily unavailable.',
      };
      return renderNotificationEmail(payload, locale, PREVIEW_SITE_URL).html;
    },
  },

  // ---- Match notifications (via generateEmailHtml) ----
  {
    id: 'match_invitation',
    label: 'Match: Invitation',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'match_invitation',
          overrides?.title ?? "You've been invited to a game!",
          overrides?.body ?? 'Alex Johnson invited you to play Tennis tomorrow.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'match_join_accepted',
    label: 'Match: Join Accepted',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'match_join_accepted',
          overrides?.title ?? "You're in the game!",
          overrides?.body ?? 'Your request to join the Tennis match has been accepted.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'match_cancelled',
    label: 'Match: Cancelled',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'match_cancelled',
          overrides?.title ?? 'Game cancelled',
          overrides?.body ??
            'The Tennis match at Parc La Fontaine has been cancelled by the organizer.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'match_updated',
    label: 'Match: Updated',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'match_updated',
          overrides?.title ?? 'Game details updated',
          overrides?.body ??
            'The Tennis match details have been updated. Please check the new time and location.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'match_starting_soon',
    label: 'Match: Starting Soon',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'match_starting_soon',
          overrides?.title ?? 'Game starts in 30 minutes!',
          overrides?.body ??
            "Your Tennis match at Parc La Fontaine starts soon. Don't forget your gear!"
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'match_reminder',
    label: 'Match: Reminder',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'reminder',
          overrides?.title ?? 'Upcoming game reminder',
          overrides?.body ?? 'You have a Tennis match tomorrow at 2:00 PM.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'match_player_joined',
    label: 'Match: Player Joined',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'match_player_joined',
          overrides?.title ?? 'A new player joined your game',
          overrides?.body ?? 'Alex Johnson has joined your Tennis match.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'match_new_available',
    label: 'Match: New Available',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'match_new_available',
          overrides?.title ?? 'New Tennis game near you',
          overrides?.body ?? 'A new Tennis game is available at Parc La Fontaine. Join now!'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'match_join_request',
    label: 'Match: Join Request',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'match_join_request',
          overrides?.title ?? 'New request to join your game',
          overrides?.body ?? 'Alex Johnson wants to join your Tennis match tomorrow.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'match_join_rejected',
    label: 'Match: Join Rejected',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'match_join_rejected',
          overrides?.title ?? 'Your request was declined',
          overrides?.body ?? 'The organizer declined your request to join the Tennis match.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'match_check_in_available',
    label: 'Match: Check-in',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'match_check_in_available',
          overrides?.title ?? 'Check-in is now open',
          overrides?.body ?? 'You can now check in for your Tennis match at Parc La Fontaine.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'player_kicked',
    label: 'Match: Player Kicked',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'player_kicked',
          overrides?.title ?? 'Removed from a game',
          overrides?.body ?? 'You have been removed from the Tennis match at Parc La Fontaine.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'feedback_request',
    label: 'Match: Feedback Request',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'feedback_request',
          overrides?.title ?? 'How was your game?',
          overrides?.body ??
            "Let us know how your Tennis match went. Your feedback helps improve everyone's experience."
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'feedback_reminder',
    label: 'Match: Feedback Reminder',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'feedback_reminder',
          overrides?.title ?? 'Reminder: rate your game',
          overrides?.body ?? "Don't forget to leave feedback for your recent Tennis match."
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },
  {
    id: 'score_confirmation',
    label: 'Match: Score Confirmation',
    category: 'Match',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'score_confirmation',
          overrides?.title ?? 'Confirm the match score',
          overrides?.body ?? 'Please review and confirm the score submitted for your Tennis match.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },

  // ---- System notifications ----
  {
    id: 'rating_verified',
    label: 'Rating Verified',
    category: 'System',
    render: (locale, overrides) =>
      generateEmailHtml(
        mockNotification(
          'rating_verified',
          overrides?.title ?? 'Your rating has been verified',
          overrides?.body ?? 'Your UTR rating of 7.5 has been verified and applied to your profile.'
        ),
        locale,
        PREVIEW_SITE_URL
      ),
  },

  // ---- Match Interest (send-email) ----
  {
    id: 'match_interest',
    label: 'Match Interest',
    category: 'Match',
    render: locale =>
      renderMatchInterestEmail({
        type: 'match_interest',
        email: 'prospect@example.com',
        name: 'Alex Johnson',
        locale,
        sportName: 'Tennis',
        matchDate: TOMORROW.toLocaleDateString(locale, { dateStyle: 'long' }),
        matchTime: '2:00 PM',
        location: 'Parc La Fontaine, Montreal',
        matchUrl: `${PREVIEW_SITE_URL}/${locale.startsWith('fr') ? 'fr-CA' : 'en-US'}/match/match-abc-123?src=email`,
      }).html,
  },

  // ---- Welcome (post-onboarding) ----
  {
    id: 'welcome',
    label: 'Welcome: Onboarding Complete',
    category: 'Onboarding',
    render: locale => {
      const payload: WelcomeEmailPayload = {
        type: 'welcome',
        email: 'newplayer@example.com',
        firstName: 'Alex',
        displayName: 'alex_plays',
        openAppUrl: PREVIEW_SITE_URL,
      };
      return renderWelcomeEmail(payload, locale).html;
    },
  },

  // ---- Morning digest ----
  {
    id: 'morning_digest',
    label: 'Morning Digest',
    category: 'Digest',
    render: locale => {
      const DAY2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      const DAY3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const DAY4 = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
      const DAY5 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
      const matches = [
        {
          id: 'match-preview-001',
          match_date: MATCH_DATE,
          start_time: '14:00:00',
          end_time: '15:30:00',
          sport_name: 'Tennis',
          facility_name: 'Parc La Fontaine',
          facility_city: 'Montréal',
          format: 'singles' as const,
          join_mode: 'direct' as const,
          player_expectation: 'casual' as const,
          is_court_free: true,
          estimated_cost: null,
          court_status: 'reserved',
          joined_count: 1,
          total_spots: 2,
          distance_km: 1.2,
        },
        {
          id: 'match-preview-002',
          match_date: DAY2,
          start_time: '18:00:00',
          end_time: '20:00:00',
          sport_name: 'Tennis',
          facility_name: 'Centre Claude-Robillard',
          facility_city: 'Montréal',
          format: 'doubles' as const,
          join_mode: 'request' as const,
          player_expectation: 'competitive' as const,
          is_court_free: false,
          estimated_cost: 20,
          court_status: null,
          joined_count: 2,
          total_spots: 4,
          distance_km: 3.8,
        },
        {
          id: 'match-preview-003',
          match_date: DAY4,
          start_time: '10:00:00',
          end_time: '11:30:00',
          sport_name: 'Padel',
          facility_name: 'Club Sportif MAA',
          facility_city: 'Montréal',
          format: 'doubles' as const,
          join_mode: 'direct' as const,
          player_expectation: 'both' as const,
          is_court_free: false,
          estimated_cost: 40,
          court_status: 'reserved',
          joined_count: 3,
          total_spots: 4,
          distance_km: 6.1,
        },
      ];
      const suggestions = [
        {
          opponent_id: 'player-preview-001',
          opponent_first_name: 'Alex',
          opponent_last_name: 'Johnson',
          opponent_rating_label: '3.5 · Intermédiaire',
          opponent_reputation_tier: 'gold',
          opponent_badge_status: null,
          sport_id: 'sport-preview-tennis',
          sport_name: 'Tennis',
          facility_id: 'facility-preview-001',
          facility_name: 'Parc La Fontaine',
          facility_city: 'Montréal',
          match_date: DAY3,
          start_time: '08:00:00',
          end_time: '09:00:00',
        },
        {
          opponent_id: 'player-preview-002',
          opponent_first_name: 'Marie',
          opponent_last_name: 'Dupont',
          opponent_rating_label: '4.0 · Avancé',
          opponent_reputation_tier: 'platinum',
          opponent_badge_status: null,
          sport_id: 'sport-preview-tennis',
          sport_name: 'Tennis',
          facility_id: 'facility-preview-002',
          facility_name: 'Club Sportif MAA',
          facility_city: 'Montréal',
          match_date: DAY5,
          start_time: '19:00:00',
          end_time: '20:30:00',
        },
        {
          opponent_id: 'player-preview-003',
          opponent_first_name: 'Luca',
          opponent_last_name: 'Rossi',
          opponent_rating_label: '3.0 · Débutant avancé',
          opponent_reputation_tier: 'silver',
          opponent_badge_status: null,
          sport_id: 'sport-preview-tennis',
          sport_name: 'Tennis',
          facility_id: 'facility-preview-001',
          facility_name: 'Parc La Fontaine',
          facility_city: 'Montréal',
          match_date: DAY4,
          start_time: '15:00:00',
          end_time: '16:00:00',
        },
      ];
      // Build a unified, chronologically-sorted preview feed mirroring what
      // the edge function produces. Cap to 6 (matches the prod cap).
      const feed = [
        ...matches.map(m => ({
          kind: 'match' as const,
          sortTime: Date.parse(`${m.match_date}T${m.start_time}`),
          data: m,
        })),
        ...suggestions.map(s => ({
          kind: 'suggestion' as const,
          sortTime: Date.parse(`${s.match_date}T${s.start_time}`),
          data: s,
        })),
      ]
        .sort((a, b) => a.sortTime - b.sortTime)
        .slice(0, 6);
      return renderMorningDigestEmail({
        firstName: 'Alex',
        locale,
        appUrl: PREVIEW_SITE_URL,
        feed,
        unsubscribeUrl: `${PREVIEW_SITE_URL}/api/digest/unsubscribe?token=preview`,
      }).html;
    },
  },

  // ---- Org notifications (via renderOrgEmail) ----
  // Title/body default to English; when the admin UI passes localized
  // overrides (via ?title=…&body=…) those win.
  ...(
    [
      {
        id: 'org_booking_confirmed',
        label: 'Org: Booking Confirmed',
        type: 'booking_confirmed',
        defaultTitle: 'Booking Confirmed',
        defaultBody: 'Your court booking has been confirmed.',
        extra: {
          bookingId: 'booking-123',
          courtName: 'Court A',
          facilityName: 'Montreal Tennis Club',
          startTime: '14:00',
          endTime: '15:00',
          priceCents: 4500,
          currency: 'CAD',
          locationAddress: '1234 Rue Sherbrooke, Montreal, QC',
        },
      },
      {
        id: 'org_booking_reminder',
        label: 'Org: Booking Reminder',
        type: 'booking_reminder',
        defaultTitle: 'Booking Reminder',
        defaultBody: 'Your court booking is tomorrow.',
        extra: {
          bookingId: 'booking-123',
          courtName: 'Court A',
          facilityName: 'Montreal Tennis Club',
          startTime: '14:00',
          endTime: '15:00',
          locationAddress: '1234 Rue Sherbrooke, Montreal, QC',
        },
      },
      {
        id: 'org_payment_received',
        label: 'Org: Payment Received',
        type: 'payment_received',
        defaultTitle: 'Payment Received',
        defaultBody: 'A payment has been processed for a court booking.',
        extra: { amountCents: 4500, currency: 'CAD', playerName: 'Alex Johnson' },
      },
      {
        id: 'org_new_member',
        label: 'Org: New Member',
        type: 'new_member_joined',
        defaultTitle: 'New Member Joined',
        defaultBody: 'A new member has joined your organization.',
        extra: { playerName: 'Alex Johnson' },
      },
      {
        id: 'org_booking_created',
        label: 'Org: Booking Created',
        type: 'booking_created',
        defaultTitle: 'New Booking',
        defaultBody: 'A new court booking was created.',
        extra: {
          bookingId: 'booking-201',
          courtName: 'Court A',
          facilityName: 'Montreal Tennis Club',
          startTime: '14:00',
          endTime: '15:00',
          priceCents: 4500,
          currency: 'CAD',
          playerName: 'Alex Johnson',
        },
      },
      {
        id: 'org_booking_cancelled_by_player',
        label: 'Org: Booking Cancelled (player)',
        type: 'booking_cancelled_by_player',
        defaultTitle: 'Booking Cancelled',
        defaultBody: 'A player cancelled their booking.',
        extra: {
          bookingId: 'booking-202',
          courtName: 'Court A',
          facilityName: 'Montreal Tennis Club',
          startTime: '14:00',
          endTime: '15:00',
          playerName: 'Alex Johnson',
        },
      },
      {
        id: 'org_booking_modified',
        label: 'Org: Booking Modified',
        type: 'booking_modified',
        defaultTitle: 'Booking Modified',
        defaultBody: 'A booking was updated.',
        extra: {
          bookingId: 'booking-203',
          courtName: 'Court A',
          facilityName: 'Montreal Tennis Club',
          startTime: '15:00',
          endTime: '16:00',
          playerName: 'Alex Johnson',
        },
      },
      {
        id: 'org_booking_cancelled_by_org',
        label: 'Org: Booking Cancelled (org)',
        type: 'booking_cancelled_by_org',
        defaultTitle: 'Your booking has been cancelled',
        defaultBody: 'The facility cancelled your court booking.',
        extra: {
          bookingId: 'booking-204',
          courtName: 'Court A',
          facilityName: 'Montreal Tennis Club',
          startTime: '14:00',
          endTime: '15:00',
        },
      },
      {
        id: 'org_member_left',
        label: 'Org: Member Left',
        type: 'member_left',
        defaultTitle: 'Member Left',
        defaultBody: 'A member left your organization.',
        extra: { playerName: 'Alex Johnson' },
      },
      {
        id: 'org_member_role_changed',
        label: 'Org: Member Role Changed',
        type: 'member_role_changed',
        defaultTitle: 'Member Role Updated',
        defaultBody: "A member's role was updated.",
        extra: { playerName: 'Alex Johnson', newRole: 'Admin' },
      },
      {
        id: 'org_payment_failed',
        label: 'Org: Payment Failed',
        type: 'payment_failed',
        defaultTitle: 'Payment Failed',
        defaultBody: 'A payment attempt failed.',
        extra: { amountCents: 4500, currency: 'CAD', playerName: 'Alex Johnson' },
      },
      {
        id: 'org_refund_processed',
        label: 'Org: Refund Processed',
        type: 'refund_processed',
        defaultTitle: 'Refund Processed',
        defaultBody: 'A refund was issued for a booking.',
        extra: { amountCents: 4500, currency: 'CAD', playerName: 'Alex Johnson' },
      },
      {
        id: 'org_weekly_report',
        label: 'Org: Weekly Report',
        type: 'weekly_report',
        defaultTitle: 'Your Weekly Report',
        defaultBody: 'Here is a summary of bookings and revenue for the past week.',
        extra: {},
      },
      {
        id: 'org_membership_approved',
        label: 'Org: Membership Approved',
        type: 'membership_approved',
        defaultTitle: 'Membership Approved',
        defaultBody: 'Your membership has been approved.',
        extra: { playerName: 'Alex Johnson' },
      },
      {
        id: 'org_announcement',
        label: 'Org: Announcement',
        type: 'org_announcement',
        defaultTitle: 'Announcement from your club',
        defaultBody:
          "Upcoming tournament registration opens this Friday at 9:00 AM. Don't miss it!",
        extra: {},
      },
    ] as const
  ).map<TemplateEntry>(({ id, label, type, defaultTitle, defaultBody, extra }) => ({
    id,
    label,
    category: 'Organization',
    render: (locale, overrides) =>
      renderOrgEmail(
        mockNotification(type, overrides?.title ?? defaultTitle, overrides?.body ?? defaultBody, {
          bookingDate: MATCH_DATE,
          paymentDate: new Date().toLocaleDateString(locale),
          ...extra,
        }),
        MOCK_ORG,
        locale,
        PREVIEW_SITE_URL
      ).html,
  })),
];

// ---------------------------------------------------------------------------
// Gallery HTML
// ---------------------------------------------------------------------------

function renderSidebarControls(templateId: string | null, locale: string, mode: string): string {
  const otherMode = mode === 'dark' ? 'light' : 'dark';
  const modeIcon = mode === 'dark' ? '&#9788;' : '&#9790;';
  const modeLabel = mode === 'dark' ? 'Light' : 'Dark';
  const base = templateId ? `template=${templateId}&` : '';

  return `
    <div style="padding:0 12px 16px;border-bottom:1px solid #e5e5e5;margin-bottom:16px;">
      <h1 style="font-size:18px;font-weight:700;color:#0d9488;">Email Preview</h1>
      <p style="font-size:12px;color:#737373;margin-top:4px;">${TEMPLATES.length} templates</p>
      <div style="margin-top:12px;display:flex;align-items:center;gap:12px;">
        <div>
          <span style="font-size:12px;color:#525252;">Locale:</span>
          <a href="?${base}locale=en-US&mode=${mode}" style="font-size:12px;color:${locale === 'en-US' ? '#0d9488;font-weight:700' : '#737373'};text-decoration:none;margin-left:6px;">en-US</a>
          <span style="color:#d4d4d4;margin:0 2px;">|</span>
          <a href="?${base}locale=fr-CA&mode=${mode}" style="font-size:12px;color:${locale === 'fr-CA' ? '#0d9488;font-weight:700' : '#737373'};text-decoration:none;">fr-CA</a>
        </div>
        <a href="?${base}locale=${locale}&mode=${otherMode}" style="font-size:12px;color:#525252;text-decoration:none;margin-left:auto;" title="Switch to ${modeLabel} mode">${modeIcon} ${modeLabel}</a>
      </div>
    </div>`;
}

function renderSidebarNav(templateId: string | null, locale: string, mode: string): string {
  const categories = [...new Set(TEMPLATES.map(t => t.category))];
  return categories
    .map(cat => {
      const items = TEMPLATES.filter(t => t.category === cat);
      const links = items
        .map(
          t =>
            `<a href="?template=${t.id}&locale=${locale}&mode=${mode}" style="display:block;padding:6px 12px;color:${templateId && t.id === templateId ? '#fff' : '#0d9488'};background:${templateId && t.id === templateId ? '#0d9488' : 'transparent'};text-decoration:none;border-radius:4px;font-size:14px;" onmouseover="if(!this.dataset.active)this.style.backgroundColor='#f0fdfa'" onmouseout="if(!this.dataset.active)this.style.backgroundColor='transparent'" ${templateId && t.id === templateId ? 'data-active="1"' : ''}>${t.label}</a>`
        )
        .join('');
      return `<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:600;color:#737373;text-transform:uppercase;letter-spacing:0.05em;padding:4px 12px;">${cat}</div>${links}</div>`;
    })
    .join('');
}

function renderGallery(locale: string, mode: string): string {
  const otherLocale = locale === 'fr-CA' ? 'en-US' : 'fr-CA';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Rallia Email Preview Gallery</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, system-ui, sans-serif; background: #f5f5f5; color: #171717; }
  </style>
</head>
<body>
  <div style="display:flex;height:100vh;">
    <!-- Sidebar -->
    <div style="width:260px;background:#fff;border-right:1px solid #e5e5e5;overflow-y:auto;padding:20px 8px;flex-shrink:0;">
      ${renderSidebarControls(null, locale, mode)}
      ${renderSidebarNav(null, locale, mode)}
    </div>
    <!-- Main -->
    <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:40px;">
      <div style="text-align:center;color:#a3a3a3;">
        <p style="font-size:48px;margin-bottom:16px;">&#9993;</p>
        <p style="font-size:16px;">Select a template from the sidebar</p>
        <p style="font-size:13px;margin-top:8px;">Toggle locale: <a href="?locale=${otherLocale}&mode=${mode}" style="color:#0d9488;">${otherLocale}</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Override the prefers-color-scheme media query to force a specific mode,
 * regardless of the user's OS/browser theme.
 *
 *   mode=dark  → @media all            (always matches)
 *   mode=light → @media not all        (never matches)
 */
function forceColorScheme(html: string, mode: string): string {
  const replacement = mode === 'dark' ? '@media all' : '@media not all';

  html = html.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/g, replacement);

  if (mode === 'dark') {
    // Activate [data-ogsc] Outlook dark mode rules
    html = html.replace(/<body(\s)/i, '<body data-ogsc$1');
  } else {
    // Remove [data-ogsc] selectors so Outlook dark mode rules never match
    html = html.replace(/\[data-ogsc\]\s+/g, '[data-no-match] ');
  }

  return html;
}

/**
 * Serve the raw rendered email HTML (used as iframe src).
 * `overrides` lets the admin UI inject locale-aware title/body resolved from
 * `@rallia/shared-translations` on the client, keeping notification copy in
 * one place (packages/shared-translations JSON).
 */
function renderRawTemplate(
  templateId: string,
  locale: string,
  mode: string,
  overrides?: TemplateOverrides
): string | null {
  const entry = TEMPLATES.find(t => t.id === templateId);
  if (!entry) return null;

  let emailHtml: string;
  try {
    emailHtml = entry.render(locale, overrides);
  } catch (err) {
    return `<html><body><pre style="padding:40px;color:red;font-family:monospace;">${String(err)}</pre></body></html>`;
  }

  // Always override the media query so the preview is deterministic
  // regardless of the user's OS/browser theme
  emailHtml = forceColorScheme(emailHtml, mode);

  return emailHtml;
}

function renderTemplateFrame(templateId: string, locale: string, mode: string): string {
  const entry = TEMPLATES.find(t => t.id === templateId);

  if (!entry) {
    return `<!DOCTYPE html><html><body><p style="padding:40px;font-family:sans-serif;">Template <code>${templateId}</code> not found.</p></body></html>`;
  }

  const isDark = mode === 'dark';
  const otherLocale = locale === 'fr-CA' ? 'en-US' : 'fr-CA';
  const otherMode = isDark ? 'light' : 'dark';
  const modeIcon = isDark ? '&#9788;' : '&#9790;';
  const modeLabel = isDark ? 'Light' : 'Dark';
  const iframeBg = isDark ? '#1a1a1a' : '#fff';

  // Use iframe src pointing to the raw endpoint — avoids srcdoc escaping issues
  const iframeSrc = `?raw=1&amp;template=${templateId}&amp;locale=${locale}&amp;mode=${mode}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${entry.label} — Rallia Email Preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, system-ui, sans-serif; background: #f5f5f5; color: #171717; }
  </style>
</head>
<body>
  <div style="display:flex;height:100vh;">
    <!-- Sidebar -->
    <div style="width:260px;background:#fff;border-right:1px solid #e5e5e5;overflow-y:auto;padding:20px 8px;flex-shrink:0;">
      ${renderSidebarControls(templateId, locale, mode)}
      ${renderSidebarNav(templateId, locale, mode)}
    </div>
    <!-- Main -->
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:12px 20px;background:#fff;border-bottom:1px solid #e5e5e5;display:flex;align-items:center;gap:12px;">
        <span style="font-weight:600;font-size:15px;color:#171717;line-height:1;">${entry.label}</span>
        <span style="font-size:12px;color:#a3a3a3;background:#f5f5f5;padding:3px 8px;border-radius:4px;line-height:1;display:inline-flex;align-items:center;margin-left:4px;">${locale}</span>
        <span style="font-size:12px;color:${isDark ? '#f5f5f5' : '#525252'};background:${isDark ? '#262626' : '#f5f5f5'};padding:3px 8px;border-radius:4px;line-height:1;display:inline-flex;align-items:center;">${isDark ? 'Dark' : 'Light'}</span>
        <div style="margin-left:auto;display:flex;gap:12px;">
          <a href="?template=${templateId}&locale=${locale}&mode=${otherMode}" style="font-size:12px;color:#0d9488;text-decoration:none;">${modeIcon} ${modeLabel} mode</a>
          <a href="?template=${templateId}&locale=${otherLocale}&mode=${mode}" style="font-size:12px;color:#0d9488;text-decoration:none;">Switch to ${otherLocale}</a>
        </div>
      </div>
      <iframe src="${iframeSrc}" style="flex:1;border:none;background:${iframeBg};"></iframe>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve((req: Request) => {
  const url = new URL(req.url);
  const templateId = url.searchParams.get('template');
  const locale = url.searchParams.get('locale') || 'en-US';
  const mode = url.searchParams.get('mode') || 'light';
  const isRaw = url.searchParams.get('raw') === '1';
  const titleOverride = url.searchParams.get('title');
  const bodyOverride = url.searchParams.get('body');
  const overrides: TemplateOverrides | undefined =
    titleOverride || bodyOverride
      ? {
          ...(titleOverride ? { title: titleOverride } : {}),
          ...(bodyOverride ? { body: bodyOverride } : {}),
        }
      : undefined;

  // Raw endpoint: serves the email HTML directly (used as iframe src)
  if (isRaw && templateId) {
    const rawHtml = renderRawTemplate(templateId, locale, mode, overrides);
    if (!rawHtml) {
      return new Response('Template not found', { status: 404 });
    }
    return new Response(rawHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  let html: string;
  if (templateId) {
    html = renderTemplateFrame(templateId, locale, mode);
  } else {
    html = renderGallery(locale, mode);
  }

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});
