/* eslint-disable no-irregular-whitespace --
 * The French text uses non-breaking spaces (U+00A0) as required by French
 * typography (before « : ; ? » and inside guillemets). These are intentional
 * legal-content characters carried over from counsel's source document. */
import type { Locale } from '@rallia/shared-translations';

/**
 * Rallia's Terms of Use, authored by legal counsel and converted from the
 * source Word documents (dated 2026-07-03) to Markdown. Rendered inline on
 * /[locale]/terms via react-markdown — replaces the former Enzuzo embed.
 *
 * To update: re-export the .docx from counsel, run it through pandoc
 * (gfm, --wrap=none) and the heading-promotion/article-numbering transform,
 * then regenerate this file. Do not hand-edit the legal wording.
 */
export const termsOfUse: Record<Locale, string> = {
  'en-US': `
# Terms of Use

**Rallia inc.**

Last updated July 3, 2026

## CONTRACTUAL FRAMEWORK

### 1. Introduction and Acceptance of the Terms

Rallia inc. (hereinafter “**Rallia**”, “**we**” or “**our**”) is a business corporation incorporated under the *Business Corporations Act* (Québec), with its head office located at 203-5740 Cavendish Boulevard, Côte-Saint-Luc, Québec H4W 2T8. Rallia operates a digital platform accessible at rallia.ca and through a mobile application (hereinafter collectively the “**Platform**”), allowing tennis and pickleball enthusiasts to connect with one another, find players of their skill level and organize games.

These terms of use (hereinafter the “**Terms**”) constitute a legally binding agreement between you (hereinafter the “**User**” or “**you**”) and Rallia. They govern all of your access to, and use of, the Platform.

By accessing or using the Platform in any manner whatsoever, including by creating an Account, downloading the Application or using any of its features, you acknowledge that you have read, understood and agreed to be bound by these Terms as well as by Rallia's Privacy Policy, available at <https://www.rallia.ca/en-US/privacy>, which is incorporated herein by reference.

If you do not accept these Terms in their entirety, you must immediately stop accessing and using the Platform.

### 2. Definitions

For the purposes of these Terms, the following expressions have the meaning assigned to them below.

**“Application”** means the Rallia mobile application, available on Apple Inc.'s App Store and Google LLC's Google Play Store.

**“Account”** means the personal account created by a User to access the features of the Platform.

**“User Content”** means any text, photograph, video, rating, comment or other item posted, uploaded or shared by a User on the Platform.

**“Service Fees”** means the fees charged by Rallia in consideration for access to certain features of the Platform, as applicable.

**“Player Matching Space”** means the feature of the Platform that allows a User to create Games or join them. It includes a directory of public Games bringing together all public Games created by Users and accessible to everyone.

**“Game”** means a sporting event organized by Users through the Player Matching Space.

**“Platform”** means all of the services offered by Rallia, including the website accessible at rallia.ca and the Application, as well as all of the features, content and services associated with them.

**“Player Directory”** means the feature of the Platform that allows a User to browse and access the public profile of other registered Users.

**“Court Directory”** means the feature of the Platform that allows tennis and pickleball courts to be located.

**“Reputation Score”** means the rating system that assigns each User a reputation and reliability indicator calculated based on their punctuality, their cancellations and the ratings received from other Users.

## ACCESS TO THE PLATFORM

### 3. Eligibility Requirements

To use the Platform, you must satisfy all of the following requirements.

1.  **Minimum Age**

You must be at least eighteen (18) years of age to use the Platform. No person under the age of eighteen (18) may create an Account or use the Platform. By accessing the Platform, you represent and warrant that you have reached the age of eighteen (18).

If Rallia discovers, or has reasonable grounds to believe, that an Account has been created or used by a person under the age of eighteen (18), it will immediately terminate that Account and delete the associated data, in accordance with the Privacy Policy. Any false statement regarding age is the sole responsibility of the User, or of their parent or legal guardian, as applicable, to the exclusion of any liability on the part of Rallia.

2.  **Legal Capacity**

You must have the legal capacity to enter into a binding contract under the laws applicable in your jurisdiction. If you use the Platform on behalf of a legal entity, you represent that you have the necessary authority to bind that entity to these Terms.

3.  **No Prior Suspension**

Your Account must not have been previously suspended or terminated by Rallia for a violation of these Terms. Any attempt to create a new Account after a termination constitutes, in itself, a violation of these Terms.

4.  **No Background Checks**

Rallia does not conduct any criminal background checks or identity verification of its Users. You expressly acknowledge and accept this fact and understand that any interaction with other Users on the Platform or during in-person meetings is at your own risk. Rallia encourages you to exercise good judgment and to adopt, at all times, the safety practices described in article 8 of these Terms.

Rallia may under no circumstances be held liable for the acts, omissions, statements or conduct of other Users resulting, directly or indirectly, from the absence of background checks.

5.  **Representations Regarding Criminal Record**

By accessing the Platform and creating an Account, you expressly represent and warrant that you have not been found guilty of a serious criminal offence, a sexual offence or an offence involving violence or the threat of violence within the meaning of the *Criminal Code* of Canada or of an equivalent criminal or penal law in any other jurisdiction. You also represent that you are not registered on the National Sex Offender Registry of Canada or any equivalent registry in any other jurisdiction.

Any false statement in this regard constitutes a serious breach of these Terms and results in the immediate termination of your Account, without prejudice to any other civil or criminal remedy available to Rallia. Rallia reserves the right to report to the competent authorities any situation of which it becomes aware that would suggest that a User has made false statements under this article.

### 4. Account Creation and Management

The features of the Platform require the creation of an Account. When creating your Account, you agree to provide accurate, complete and up-to-date information, and to keep it that way throughout your use of the Platform. Any false or incomplete information may result in the suspension or termination of your Account.

Your Account is strictly personal. You may not assign your Account to a third party, share your login credentials or allow anyone to access your Account on your behalf. You are solely responsible for the confidentiality of your credentials and for all activities carried out through your Account, whether or not authorized by you.

You must notify Rallia without delay of any unauthorized access to your Account or any other breach of its security, by contacting us at contact@rallia.ca. Rallia may not be held liable for losses or damages resulting from the unauthorized use of your credentials where you have failed to fulfill your obligation to keep them confidential or to notify us without delay.

Rallia reserves the right to deactivate, change or delete any identifier, whether chosen by you or provided by Rallia, at any time and for any reason, including in the event of a violation of these Terms.

### 5. Client Portal and Dashboard

1.  **Content and Access**

The Application provides every User holding an Account with a personal space (hereinafter the “**Client Portal**”) accessible from their dashboard. The Client Portal notably allows them to access the following items.

1.  The history of Games in which they have participated or that they have organized, as well as upcoming Games that they have confirmed;

2.  Official Game confirmations, automatically generated by the Platform following registration for, or creation of, a Game;

3.  Their receipts and billing history related to their subscription;

4.  A directory of public Games created by other Users, which the User can browse and join;

5.  The Court Directory, allowing the User to browse listed tennis and pickleball courts, view their characteristics and availability and initiate the booking process with the manager of the court concerned, as described in article 7.1 of these Terms;

6.  A Player Directory allowing the User to browse and access the public profile of other Users registered on the Platform;

7.  An integrated messaging feature allowing the User to communicate with other Users, individually or in groups;

8.  Any other feature or information that Rallia may make available in the Client Portal at its sole discretion, in accordance with the terms described in article 5.4 of these Terms.

Rallia remains the owner of the Client Portal interface and of all data that passes through it, subject to the rights that Users retain over their personal information in accordance with the Privacy Policy.

2.  **Legal Value of Official Confirmations**

Any Game confirmation posted in the Client Portal or sent to the email address associated with the User's Account constitutes official notice and delivery of a document within the meaning of these Terms. The confirmation is deemed received as soon as it is made available in the Client Portal or sent by email, whichever occurs first.

It is the User's responsibility to regularly check their Client Portal and to keep their email address up to date in their Account settings. Rallia may not be held liable for the consequences arising from a User's failure to check their confirmations or to update their contact information, including in the event of a dispute relating to a cancellation of, or absence from, a Game.

3.  **Internal Messaging**

To the extent the internal messaging feature is enabled on the Platform, the User may exchange messages with other Users directly from their Client Portal. This feature is made available as an ancillary service, and its deployment, modification or suspension is at Rallia's sole discretion.

Use of the internal messaging feature is subject to all of the obligations set out in article 8 of these Terms. In particular, it is prohibited to use the internal messaging feature for commercial or advertising purposes, to solicit other Users for purposes other than organizing Games, to circumvent the payment mechanisms integrated into the Platform, or for any exchange contrary to these Terms or to applicable laws.

Rallia reserves the right to access messages exchanged through the internal messaging feature to the extent permitted by applicable law, in particular for security purposes, to prevent abuse or to resolve disputes between Users. The User should not have a reasonable expectation of absolute confidentiality with respect to messages exchanged through the Platform's internal messaging feature.

4.  **Evolution of the Client Portal**

The content, features and options available in the Client Portal may be modified, expanded, restricted or enhanced at any time, at Rallia's sole discretion. The addition of new features to the Client Portal does not constitute a material amendment to these Terms and does not require separate notice, unless such new features impose additional obligations on the User or significantly alter their rights.

Rallia will make reasonable efforts to inform Users of material additions or changes made to the Client Portal, by way of notification in the Application or by email. Continued use of the Client Portal after any change constitutes acceptance of that change.

5.  **Availability**

Rallia does not guarantee the continuous and uninterrupted availability of the Client Portal. Temporary interruptions may occur, in particular in connection with maintenance operations, technical updates or events beyond Rallia's control. Such interruptions do not give rise to any compensation or refund. The provisions of article 16 of these Terms apply fully to the Client Portal.

## NATURE OF THE SERVICE

### 6. Nature of the Platform

Rallia is a technological intermediary. Its role is limited to providing a digital platform that allows tennis and pickleball players to connect with one another, find playing partners, facilitate court bookings, and organize Games. Rallia is not an organizer of Games and takes no part whatsoever in the sporting activities organized through the Platform.

Rallia is not a party to interactions between Users. It does not select, supervise or control the conduct of Users on the court or during their in-person meetings. Rallia does not guarantee the attendance, punctuality, actual skill level, conduct or reliability of any User whatsoever.

The Reputation Score and the badges displayed on Users' profiles are generated from data provided by the Users themselves and from ratings that they have given one another. They constitute informational indicators only and do not represent any guarantee or certification by Rallia as to a User's future conduct.

You expressly acknowledge and agree that Rallia cannot be held liable for the acts, omissions, conduct or statements of other Users, whether on the Platform or during in-person meetings.

### 7. Description of Features

1.  **Court Directory (Court Finder)**

The Court Directory allows tennis and pickleball courts near the User to be located. Information relating to the courts is derived, in whole or in part, from community data provided by Users or from third-party sources. Rallia does not certify the accuracy, completeness or currency of this information. It does not endorse any of the listed courts and does not guarantee their availability or the conditions of access to them.

Where the Court Directory redirects the User to a third-party site or platform to make a booking, Rallia is not a party to that transaction and assumes no liability in respect of it. The User is solely responsible for ensuring that they are authorized to use the court in question.

2.  **Player Matching Space (Game Marketplace)**

The Player Matching Space allows the User to create Games or join them, specifying in particular the sport played, the game format, the level required, the location and the cost-sharing arrangements. It includes a directory of public Games bringing together all public Games created by Users, which any User can browse and join subject to the conditions set by the creator of each Game. The rules applicable to the organization of Games and to cost-sharing are set out in articles 9 and 10 of these Terms.

3.  **Player Directory**

The Player Directory allows the User to browse and access the public profile of all other Users registered on the Platform. Each User may view the information that another User has chosen to make public. The information displayed in the Player Directory comes from the Users themselves. Rallia does not guarantee its accuracy or currency.

The Player Directory includes two sub-features.

1.  **Groups**

Groups allow a User to create or join a restricted group of players, limited to a maximum of twenty (20) members, around a common interest such as a circle of friends, a family, a group of colleagues or any other affinity chosen by the members. Groups are private. They are not visible to other Users of the Platform, and membership is granted only by invitation from an existing member. Each group gives its members exclusive access to a discussion forum and to a directory of private Games reserved for the members of the group concerned.

2.  **Communities**

Communities operate on the same principles as groups but may accommodate an unlimited number of members around a common interest such as a city, a league, a school or any other affinity chosen by the members. Communities may be public or private, at the discretion of their creator or their moderators. Public communities are visible to all Users of the Platform, but membership remains subject to a moderator's approval. Private communities are not visible to other Users, and membership is granted only by invitation or a moderator's approval.

3.  **Moderation and Responsibility**

Content posted in the discussion forums of groups and communities constitutes User Content within the meaning of article 13 of these Terms. The creator and moderators of a group or community are responsible for moderating the content posted in their respective space. Rallia assumes no responsibility for content posted by Users in groups and communities, subject to its right of intervention set out in article 13.4 of these Terms.

4.  **Certified Skill Levels (Verified Skill Levels)**

This feature allows the User to indicate and have their skill level recognized under the NTRP or DUPR scales, by submitting video evidence or references from other Users. This certification is based entirely on information provided by the User and does not constitute an independent assessment performed by Rallia. Rallia is not affiliated with, and does not endorse, any of the organizations that administer the NTRP or DUPR scales. The rules applicable to skill level certification are set out in article 8 of these Terms.

5.  **Reputation Score**

The Reputation Score assigns each User an indicator and badges (Bronze, Silver, Gold, Platinum) calculated according to the criteria described in article 14 of these Terms. Rallia reserves the right to modify these criteria at any time. Any material modification will be communicated to Users in accordance with the terms set out in article 22 of these Terms.

## USE OF THE PLATFORM

### 8. General Obligations of the User

By using the Platform, you agree to comply with all applicable laws and regulations, including the laws of the province of Québec and the federal laws of Canada.

Without limiting the generality of the foregoing, you agree not to do any of the following.

1.  Make false statements concerning your identity, your skill level or any other relevant information on your profile or when using the Platform;

2.  Harass, threaten, intimidate or infringe the rights of other Users, whether on the Platform or during in-person meetings;

3.  Use the Platform for commercial, advertising or solicitation purposes without Rallia's prior written consent, including to recruit Users to a competing platform or service;

4.  Direct exchanges or transactions related to Games or to any activity covered by the Platform toward channels external to it, such as WhatsApp, Telegram, email or text messaging, where such exchanges are intended to circumvent the features or payment mechanisms integrated into the Platform;

5.  Send or solicit money, cryptocurrencies, gift cards or any other monetary value to or from other Users outside the payment mechanisms integrated into the Platform;

6.  Post, upload or share on the Platform any content that is defamatory, obscene, hateful, violent, discriminatory or that infringes the rights of a third party, including their copyright, right to privacy or right to their image;

7.  Introduce viruses, malware, Trojan horses or any other element harmful to the operation of the Platform or the systems of other Users;

8.  Attempt to gain unauthorized access to any system, database or Account related to the Platform, including by reverse engineering, decompiling or disassembling it;

9.  Use bots, web crawlers or any other automated tool to extract data from the Platform without Rallia's prior written consent;

10. Use the Platform in a manner likely to harm Rallia's reputation or expose Rallia to civil or criminal liability.

Rallia reserves the right to monitor use of the Platform to the extent permitted by applicable law, and to record Users' interactions for security, compliance and service improvement purposes.

**Safety Recommendations**

Given the nature of the Platform, which involves in-person meetings between individuals who do not necessarily know one another, Rallia recommends that Users adopt the following practices at all times.

1.  Meet other Users in public places;

2.  Inform a trusted person of their plans before attending a Game organized through the Platform;

3.  Never disclose sensitive personal information to other Users, such as a home address, financial information or health data;

4.  Immediately report any suspicious, inappropriate or potentially dangerous conduct to Rallia at contact@rallia.ca;

5.  Call 911 in the event of immediate danger.

These recommendations are provided for informational purposes only. Their application by the User does not in any way diminish the User's exclusive responsibility for their own safety during in-person meetings organized through the Platform.

**Warning Against Scams**

Rallia will never ask you to move a conversation or a transaction outside the Platform. Any solicitation to that effect from another User should be considered suspicious and reported immediately to Rallia at contact@rallia.ca.

You are strictly prohibited from sending or soliciting money, cryptocurrencies, gift cards or any other monetary instrument to or from other Users by any means other than the payment mechanisms integrated into the Platform. Rallia will never be liable for financial losses resulting from a transaction carried out outside these mechanisms.

**Feedback and Suggestions**

If you send Rallia any comments, suggestions or improvement ideas relating to the Platform, you grant Rallia a perpetual, worldwide, non-exclusive and royalty-free license to use these contributions for any purpose related to the development of the Platform, without any obligation to credit the source or to pay you any consideration.

### 9. Skill Level Certification

The skill level certification feature relies on the honesty and good faith of Users. By submitting a certification request, you represent and warrant that the information provided, including video evidence, is accurate, authentic and personally concerns you.

Certification is granted automatically as soon as a video is submitted by the User. Rallia does not conduct any human review or automated verification of the content of the submitted videos. Certification videos are made accessible to other Users of the Platform, who may attach rating indicators to them. These indicators are provided for informational purposes only and do not constitute validation of the skill level by Rallia.

By submitting a certification video, you expressly agree that it may be viewed by other Users of the Platform and that they may attach rating indicators to it. You represent that you hold all of the rights necessary in the content of the submitted video, and warrant that it does not infringe the rights of any third party.

It is strictly prohibited to submit a video that does not depict you, to misrepresent the skill level of a third party, or to obtain certification by any other fraudulent means. Any false statement regarding your skill level constitutes a serious breach of these Terms that may result in the immediate revocation of the certification, a downgrade of your Reputation Score, and the suspension or permanent termination of your Account, without prejudice to any other remedy available to Rallia.

Rallia reserves the right to withdraw or modify a User's certification if it has reasonable grounds to believe that the information used to establish it is inaccurate or fraudulent. This decision may be made without any obligation of prior notice and without compensation.

Certification of a skill level on the Platform does not constitute official recognition by a sports organization and does not confer any right or accreditation within the meaning of the rules of associations such as Tennis Canada, Pickleball Canada or their affiliates.

### 10. Organization of Games and Sporting Code of Conduct

Every User who creates or joins a Game through the Player Matching Space undertakes to honour their participation. More specifically, you agree to do the following.

1.  Show up at the time and place agreed upon for any Game that you have confirmed;

2.  Comply with the rules of the sport played as well as the rules governing use of the court;

3.  Adopt fair-play, respectful conduct consistent with the spirit of good sportsmanship toward all participants, before, during and after the Game;

4.  Report to Rallia any inappropriate or threatening conduct, or conduct contrary to these Terms, on the part of another User, at contact@rallia.ca;

5.  Comply with the cost-sharing arrangements agreed upon when the Game was created or joined.

An unjustified absence or a cancellation made after the deadline set when the Game was created constitutes a breach of these Terms. Depending on the severity or repetition of the breach, Rallia may, in its sole discretion, downgrade the Reputation Score of the User concerned, temporarily or permanently restrict their access to the Player Matching Space, or terminate their Account.

Rallia is not a party to Games organized through the Player Matching Space. It cannot be held liable for the cancellation of a Game, the absence or conduct of a User, injuries or damages occurring during a Game, or any dispute between Users relating to the conduct of a Game.

## PAYMENTS AND SUBSCRIPTIONS

### 11. Payments

The only payments processed directly by Rallia at the launch of the Platform are the subscription fees for the premium tier described in article 12 of these Terms. The sharing of court fees between Users in connection with the organization of Games takes place directly between the participants, outside the Platform. Rallia is not a party to these transactions and assumes no liability in respect of them.

All amounts displayed on the Platform are in Canadian dollars. The goods and services tax (GST) and the Québec sales tax (QST) are added, as applicable, in accordance with applicable tax laws.

Rallia accepts the following payment methods for subscriptions, namely Visa, Mastercard, Apple Pay, Google Pay, as well as in-app purchases through Apple's App Store and Google's Google Play Store. Rallia reserves the right to add, modify or remove any payment method at any time, upon reasonable notice posted on the Platform.

1.  **Billing Errors**

If you believe that an amount has been billed to you in error, you must notify Rallia in writing at contact@rallia.ca within fifteen (15) days of the billing date. If you fail to notify us within that period, the amount billed will be deemed accepted by you, and you waive any recourse in that regard.

An administrative fee of two hundred dollars ($200), plus applicable taxes, may apply to any chargeback initiated with your financial institution that is found to be unsubstantiated following Rallia's review of the file. If the dispute is found to be unsubstantiated, Rallia reserves the right to claim the amounts owed through any appropriate legal means.

### 12. Subscriptions

1.  **Access Tiers**

The Platform is currently offered free of charge (hereinafter the “**Free Plan**”). The Free Plan provides access to the features of the Platform at no charge. Rallia reserves the right to modify the features included in the Free Plan at any time, upon reasonable notice.

Rallia reserves the right to subsequently introduce one or more paid plans, in consideration for the payment of subscription fees. The terms applicable to any paid plan will be communicated to Users before they take effect and incorporated into these Terms by way of an amendment made in accordance with article 22.

## CONTENT AND REPUTATION

### 13. User-Generated Content

You are solely and entirely responsible for the User Content that you post, upload or share on the Platform. By submitting User Content, you represent and warrant that you hold all of the rights necessary to post it, that such content is accurate and lawful, and that it does not violate the rights of any third party, including copyright, the right to privacy or the right to one's image.

1.  **License Granted to Rallia**

By submitting User Content, you grant Rallia a non-exclusive, worldwide, royalty-free, sub-licensable and transferable license to use, reproduce, adapt, distribute, publicly display and showcase such Content, solely to the extent necessary for the operation, development and promotion of the Platform. This license terminates when you delete the Content concerned from the Platform or when your Account is closed, subject to copies already in circulation as part of the normal operation of the Platform and technical backups.

You retain full ownership of your User Content. Rallia does not claim any ownership right in it.

2.  **Moral Rights**

To the extent permitted by the *Copyright Act* (Canada), you waive your right of paternity in the work for any use made by Rallia under the license set out in article 13.1, and solely for the purposes of operating the Platform. You retain all of your moral rights for any use that would exceed the scope of this license

3.  **Photographs and Videos**

By uploading a photograph or a video to the Platform, including as a profile photo or as skill level certification evidence, you grant Rallia a worldwide, non-exclusive and royalty-free license to use, modify, adapt, reproduce, distribute and display such content, in whole or in part, solely for the purposes of promoting and operating Rallia's Platform. This license remains in effect for the duration of your Account and for a reasonable period following its closure, to allow Rallia to progressively remove such content from its communication materials. It does not grant Rallia any right to use such content for commercial purposes for the benefit of third parties.

You represent that you hold all of the rights necessary in the photographs and videos that you upload, and warrant that they do not infringe the rights of any third party.

4.  **Content Moderation**

Rallia reserves the right, without being obligated to do so, to monitor, review, modify, refuse to post or remove any User Content, at any time and for any reason, in particular if it reasonably believes that such content violates these Terms, infringes the rights of a third party or is likely to expose Rallia to liability. This right of moderation does not create, for Rallia, an obligation to monitor all User Content nor any liability for content that it has not removed.

Rallia cannot be held liable for User Content posted by third parties on the Platform, whether or not such content is accurate, complete or up to date.

### 14. Reputation Score and Ratings

The Reputation Score is calculated automatically based on Platform usage data, including punctuality at Games, the number and frequency of cancellations, and the ratings left by other Users. The Bronze, Silver, Gold and Platinum badges are awarded according to thresholds set by Rallia, which may be modified.

Ratings submitted by Users constitute User Content within the meaning of article 13 of these Terms. To be valid, a rating must satisfy all of the following criteria.

1.  It must be based on a direct, personal experience with the User being rated;

2.  It may not contain discriminatory, abusive, defamatory or hateful remarks;

3.  It may not draw conclusions regarding the legality of another User's conduct;

4.  It may not be submitted as part of an organized campaign aimed at improving or degrading a User's Reputation Score, whether positive or negative;

5.  It may not originate from a User affiliated with a competitor of the Platform for the purpose of harming another User or Rallia.

Any attempt to manipulate the Reputation Score, whether by submitting fictitious ratings, coordinating between Users for fraudulent purposes or any other means, constitutes a serious breach of these Terms and may result in the immediate termination of the Account of the Users involved following a reasonable investigation by Rallia.

Rallia reserves the right to remove any rating that it considers, in its sole discretion, to be contrary to these Terms or likely to cause unjustified harm to a User, by notifying you, without any obligation to give reasons for its decision. This right of removal does not make Rallia a party responsible for the ratings posted on the Platform.

## INTELLECTUAL PROPERTY

### 15. Rallia's Intellectual Property

The Platform and all of its components, including, without limitation, its source code, architecture, interfaces, text, graphics, logos, icons, algorithms, databases and features, are the exclusive property of Rallia or its licensors, and are protected by the *Copyright Act* (Canada), the *Trademarks Act* (Canada) and other applicable intellectual property laws in Canada.

These Terms do not grant you any ownership right in the Platform or in any of its components. You are granted only a limited, personal, non-exclusive, non-transferable and revocable right of access and use, strictly for the purposes set out in these Terms.

You are notably prohibited from reproducing, distributing, modifying, adapting, translating, creating derivative works from, decompiling, disassembling or otherwise attempting to extract the source code of the Platform or of any of its components, without Rallia's prior written consent. Any unauthorized use of Rallia's intellectual property may result in your civil liability and, where applicable, criminal liability.

The trademarks, trade names, logos and other distinctive signs of Rallia displayed on the Platform are the exclusive property of Rallia. Nothing in these Terms grants you the right to use these signs for any purpose whatsoever without Rallia's prior written consent.

## LIABILITY

### 16. Disclaimers and Limitations of Liability

1.  **Platform Provided “As Is”**

The Platform is provided by Rallia “as is” and “as available”, without any warranty of any kind, express or implied, including as to its accuracy, completeness, reliability, fitness for a particular purpose or uninterrupted operation. Rallia does not warrant that the Platform will be free of errors, viruses or other harmful elements, or that technical failures will be corrected within any given timeframe.

To the extent permitted by applicable law, Rallia disclaims all liability for direct, indirect, incidental, special, consequential or punitive damages resulting from the use of, or inability to use, the Platform, even if Rallia has been advised of the possibility of such damages.

2.  **Sporting Activities and In-Person Meetings**

Playing tennis and pickleball involves inherent risks of physical injury. By using the Platform to organize or join a Game, you acknowledge and accept these risks and expressly release Rallia from any liability for injuries, property damage or any other harm occurring during a Game organized through the Platform. This exclusion does not apply where Rallia's liability arises from its own gross or intentional fault, or in cases where the law prohibits such exclusion.

Similarly, any in-person meeting with another User is at your own risk. Rallia cannot be held liable for a User's conduct during such meetings, regardless of their nature.

3.  **Third-Party Content and Court Directory**

Rallia is not responsible for the accuracy or availability of the court information contained in the Court Directory, or for the content of third-party sites or platforms to which the Platform redirects the User. Access to such third-party resources is at the User's sole responsibility and is subject to the terms of use of those third parties.

4.  **Liability Cap**

To the fullest extent permitted by applicable law, Rallia's total cumulative liability to you, for any claim arising from these Terms or from your use of the Platform, is limited to the total amount that you have actually paid to Rallia during the twelve (12) months preceding the event giving rise to the claim, or to one hundred (100) Canadian dollars if you have made no payment during that period.

This limitation of liability does not apply in cases where applicable law prohibits such exclusion, in particular in the event of fraud, intentional fault or gross fault on the part of Rallia.

### 17. Indemnification by the User

You agree to defend, indemnify and hold harmless Rallia, its directors, officers, employees, agents, shareholders and subcontractors, from and against any claim, action, loss, damage, judgment, expense or cost, including court costs and disbursements and reasonable extrajudicial fees (including lawyers' fees), arising from your use of the Platform, your violation of these Terms, your violation of the rights of a third party, your User Content, or your participation in a Game organized through the Platform.

Rallia reserves the right to assume the exclusive defence and control of any matter subject to indemnification by you, in which case you agree to cooperate fully with Rallia in conducting that defence. This indemnification undertaking remains in effect after the termination of these Terms and the closing of your Account.

## ACCOUNT LIFECYCLE

### 18. User Data

Rallia retains the data that you submit to the Platform in order to ensure its operation and improve your user experience. Although Rallia performs periodic backups of its systems, these backups are performed for operational purposes and do not constitute a guarantee of the preservation of your personal information or your User Content.

You are solely responsible for the data that you submit to the Platform and for any activity that you carry out through it. Rallia cannot be held liable for the loss, corruption or deletion of your data, regardless of the cause, including a technical failure, a cyberattack or any other circumstance beyond its control. You hereby waive any recourse against Rallia arising from the loss or corruption of your data.

Deletion of your Account results in the progressive deletion of your personal information in accordance with Rallia's Privacy Policy. Certain data may nevertheless be retained for the period required by applicable law or for Rallia's legitimate purposes, in particular to defend its rights in the event of a dispute.

### 19. Suspension and Termination of the Account

1.  **Termination at the User's Initiative**

You may close your Account at any time by logging into your Account and following the closure procedure provided in the settings of the Application or the website, or by contacting us at contact@rallia.ca. Closing your Account results in the loss of access to all features of the Platform as well as the deletion of your data, in accordance with Rallia's Privacy Policy.

Closing your Account does not entitle you to a refund of fees already incurred, except in cases expressly provided for by applicable law.

2.  **Suspension or Termination by Rallia**

Rallia reserves the right to suspend or terminate your Account for any of the following reasons.

In the event of a serious breach, suspension or termination may occur immediately and without prior notice. The following situations, in particular, constitute serious breaches.

1.  Fraudulent conduct, including any false statement regarding your identity, your age or your skill level;

2.  Abusive, harassing or threatening conduct toward other Users or toward representatives of Rallia;

3.  Use of the Platform for illegal purposes or purposes contrary to public order;

4.  Participation in the manipulation of the Reputation Score or the rating system;

5.  Creation of a new Account after termination of a prior Account by Rallia.

In the event of a less serious breach, Rallia will send you a notice by email or by notification in the Application, granting you a period of fifteen (15) days to remedy the situation. If the breach is not corrected within that period, Rallia may proceed to suspend or terminate the Account. The following situations, in particular, constitute less serious breaches.

1.  A violation of these Terms other than those referred to above;

2.  Non-payment of amounts owed to Rallia;

3.  Prolonged inactivity of the Account, meaning any period of inactivity exceeding 12 months;

4.  Any other reason that Rallia reasonably considers justified to protect the integrity of the Platform or the safety of its Users.

The suspension may be temporary or permanent, depending on the severity of the breach and Rallia's assessment. In the event of termination for violation of these Terms, you are not entitled to any refund of fees already incurred, except in cases provided for by law.

3.  **Effects of Termination**

Termination of the Account, whether at your initiative or Rallia's, results in the immediate cessation of your right to access and use the Platform. The provisions of these Terms which, by their nature, are intended to survive termination will remain in effect thereafter, in particular articles 13 (User-Generated Content), 15 (Intellectual Property), 16 (Disclaimers and Limitations of Liability), 17 (Indemnification) and 24 (Governing Law and Dispute Resolution).

## FINAL PROVISIONS

### 20. Protection of Personal Information

The collection, use, retention and disclosure of your personal information in connection with your use of the Platform are governed by Rallia's Privacy Policy, available at <https://www.rallia.ca/en-US/privacy>, which is incorporated into these Terms by reference.

Rallia's Privacy Policy complies with the requirements of the *Act respecting the protection of personal information in the private sector* (Québec), as well as the requirements of the *Act respecting the protection of personal information and electronic documents*. By accepting these Terms, you also acknowledge that you have reviewed the Privacy Policy and accept its terms.

### 21. Mobile Application

The Application is available on Apple Inc.'s App Store and Google LLC's Google Play Store (hereinafter the “**Distributors**”). By downloading or using the Application through either of these platforms, you acknowledge and agree to the following.

These Terms are entered into between you and Rallia only, and not between you and the Distributors. The Distributors have no obligation to you under these Terms. The Distributors' liability with respect to the Application is strictly limited to what is provided for in their own terms of service.

If the Application fails to conform to any applicable warranty, you may notify the relevant Distributor, which may, as applicable, refund the purchase price in accordance with its own terms. To the fullest extent permitted by applicable law, the Distributor assumes no other warranty obligation with respect to the Application.

You agree to comply with the applicable terms of use of the relevant Distributor when using the Application. You acknowledge that the Distributors are third-party beneficiaries of these Terms and that, in that capacity, they have the right to enforce the terms against you.

### 22. Amendments to these Terms

Rallia reserves the right to amend these Terms at any time. Any amendment will be communicated to Users by posting an updated version on the Platform, together with a revised update date. In the event of a material amendment, Rallia will make reasonable efforts to notify you by email or by notification in the Application, within a reasonable time before the amendment takes effect.

The Terms applicable to your use of the Platform are those in effect at the time of such use. Continuing to use the Platform after the amended Terms take effect constitutes acceptance of them. If you do not accept the amended Terms, you must stop using the Platform and close your Account.

### 23. Force Majeure

Rallia cannot be held liable for any delay or failure in the performance of its obligations where such delay or failure results from an event of force majeure, meaning any event that is unforeseeable, irresistible and beyond its reasonable control, including, in particular, major technological failures, cyberattacks, natural disasters, epidemics, pandemics, strikes, decisions of governmental authorities or any other circumstance reasonably beyond its control.

In such a case, Rallia will inform Users as soon as possible by any appropriate means, and its obligations will be suspended for the duration of the event. Rallia will resume performance of its obligations as soon as the force majeure event ceases, without such resumption constituting any admission of liability for the suspension period. If the force majeure event continues for more than thirty (30) consecutive days, Rallia reserves the right to suspend or modify the affected features of the Platform, without any compensation being claimable in that regard.

### 24. Governing Law and Dispute Resolution

1.  **Governing Law**

These Terms are governed exclusively by the laws of the province of Québec and the applicable federal laws of Canada, without regard to any conflict of laws rules that might result in the application of the law of another jurisdiction.

2.  **Attempt at Amicable Settlement**

In the event of a dispute arising from these Terms or from the use of the Platform, the party wishing to initiate a settlement process shall notify the other party in writing, specifying the nature of the dispute and the proposed solution. The parties will then have a period of thirty (30) days following receipt of that notice to reach an amicable settlement, which period may be extended by mutual agreement.

3.  **Judicial Jurisdiction**

Failing an amicable settlement, any dispute arising from these Terms or from the use of the Platform is submitted to the jurisdiction of the courts of Québec, in the judicial district of Montréal.

4.  **Interim and Protective Measures**

Nothing in this article prevents Rallia from seeking an injunction or any other interim or protective measure before any court of competent jurisdiction, where it considers this necessary to protect its rights, in particular with respect to intellectual property or a serious violation of these Terms. The bringing of such an application does not constitute a waiver of the mediation obligation set out in article 24.3.

### 25. General Provisions

1.  **No Waiver**

Rallia's failure to require performance of any provision of these Terms, or to exercise any right or remedy to which it is entitled, does not constitute a waiver of that provision, right or remedy. Rallia retains, at all times, the right to avail itself of all of these Terms.

2.  **Severability**

If a provision of these Terms is found to be invalid, illegal or unenforceable by a court of competent jurisdiction, that provision will be deemed amended to the minimum extent necessary to make it valid and enforceable, in keeping with the original intent of the parties. The other provisions of these Terms remain in full force and effect.

3.  **Assignment**

You may not assign, transfer or delegate all or part of your rights or obligations under these Terms without Rallia's prior written consent. Rallia may assign these Terms, in whole or in part, without your consent, including in connection with a merger, an acquisition or a sale of all or part of its assets.

4.  **Language**

These Terms have been drafted in French in accordance with the *Charter of the French Language* (Québec). Every User residing in Québec has the right to receive these Terms, as well as any related contractual document, in the French language. In the event of a version in another language, the French version prevails in the event of any discrepancy.

5.  **Contract Formed Electronically**

These Terms are entered into electronically. In accordance with the Act, the contract so formed has the same legal value as a contract written on paper. Acceptance of these Terms electronically, in particular by creating an Account or using the Platform, constitutes a valid electronic signature and binds the User in the same manner as a handwritten signature.

6.  **Email Confirmation**

The confirmation sent by email to the User following their registration on the Platform, the creation of a Game or any other act giving rise to the formation of a contract constitutes delivery of a copy of the contract within the meaning of the *Consumer Protection Act* (Québec), to the extent that this act applies to the transaction concerned. It is the User's responsibility to keep this confirmation as proof of the transaction.

7.  **Entire Agreement**

These Terms, Rallia's Privacy Policy and, where applicable, any specific policy or rule published on the Platform in connection with a particular feature, constitute the entire agreement between you and Rallia with respect to the subject matter hereof. They supersede any prior agreement, communication or representation between the parties in that regard.

8.  **Interpretation of Headings**

The titles of the articles and sections of these Terms are inserted for reference and convenience only. They do not form part of the Terms and do not affect their scope or interpretation.

### 26. Contact Us

For any question relating to these Terms or to your use of the Platform, you may contact us using the following information.

**Rallia inc.**

203-5740 Cavendish Boulevard

Côte-Saint-Luc, Québec H4W 2T8

Telephone : +1 514 601-4198

E-mail : contact@rallia.ca

Website : rallia.ca
`,
  'fr-CA': `
# Conditions générales d'utilisation

**Rallia inc.**

Dernière mise à jour : 3 juillet 2026

## CADRE CONTRACTUEL

### 1. Introduction et acceptation des conditions

Rallia inc. (ci-après « **Rallia** », « **nous** » ou « **notre** ») est une société par actions constituée en vertu de la *Loi sur les sociétés par actions* (Québec), dont le siège social est situé au 203-5740 boulevard Cavendish, Côte-Saint-Luc (Québec) H4W 2T8. Rallia exploite une plateforme numérique accessible à l'adresse rallia.ca et par l'entremise d'une application mobile (ci-après collectivement la « **Plateforme** »), permettant aux amateurs de tennis et de pickleball de se connecter, de trouver des joueurs de leur niveau et d'organiser des parties.

Les présentes conditions d'utilisation (ci-après les « **Conditions** ») constituent un accord juridiquement contraignant entre vous (ci-après l'« **Utilisateur** » ou « **vous** ») et Rallia. Elles régissent l'ensemble de votre accès à la Plateforme et de votre utilisation de celle-ci.

En accédant à la Plateforme ou en l'utilisant de quelque manière que ce soit, notamment en créant un Compte, en téléchargeant l'Application ou en utilisant l'une ou l'autre de ses fonctionnalités, vous reconnaissez avoir lu, compris et accepté d'être lié par les présentes Conditions ainsi que par la Politique de confidentialité de Rallia, disponible à l'adresse <https://www.rallia.ca/fr-CA/privacy>, laquelle est incorporée aux présentes par référence.

Si vous n'acceptez pas les présentes Conditions dans leur intégralité, vous devez cesser immédiatement d'accéder à la Plateforme et de l'utiliser.

### 2. Définitions

Aux fins des présentes Conditions, les expressions suivantes ont le sens qui leur est attribué ci-après.

**« Application »** désigne l'application mobile Rallia, disponible sur l'App Store d'Apple Inc. et le Google Play Store de Google LLC.

**« Compte »** désigne le compte personnel créé par un Utilisateur pour accéder aux fonctionnalités de la Plateforme.

**« Contenu utilisateur »** désigne tout texte, photographie, vidéo, évaluation, commentaire ou autre élément publié, téléversé ou partagé par un Utilisateur sur la Plateforme.

**« Frais de service »** désigne les frais facturés par Rallia en contrepartie de l'accès à certaines fonctionnalités de la Plateforme, le cas échéant.

**« Espace de mise en relation entre joueurs »** désigne la fonctionnalité de la Plateforme permettant à un Utilisateur de créer des Parties ou d'en rejoindre. Elle inclut un répertoire des Parties publiques regroupant l'ensemble des Parties publiques créées par les Utilisateurs et accessibles à tous.

**« Partie »** désigne un événement sportif organisé par des Utilisateurs via l’Espace de mise en relation entre joueurs.

**« Plateforme »** désigne l'ensemble des services offerts par Rallia, comprenant le site web accessible à l'adresse rallia.ca et l'Application, ainsi que l'ensemble des fonctionnalités, contenus et services qui y sont associés.

**« Répertoire de joueurs »** désigne la fonctionnalité de la Plateforme permettant à un Utilisateur d'explorer et d'accéder au profil public des autres Utilisateurs inscrits.

**« Répertoire de terrains »** désigne la fonctionnalité de la Plateforme permettant de localiser des terrains de tennis et de pickleball.

**« Score de réputation »** désigne le système d'évaluation attribuant à chaque Utilisateur un indicateur de réputation et de fiabilité calculé à partir de sa ponctualité, de ses annulations et des évaluations reçues d'autres Utilisateurs.

## ACCÈS À LA PLATEFORME

### 3. Conditions d'éligibilité

Pour utiliser la Plateforme, vous devez satisfaire à l'ensemble des conditions suivantes.

1.  **Âge minimum**

Vous devez être âgé d'au moins dix-huit (18) ans pour utiliser la Plateforme. Aucune personne de moins de dix-huit (18) ans ne peut créer un Compte ni utiliser la Plateforme. En accédant à la Plateforme, vous déclarez et garantissez avoir atteint l'âge de dix-huit (18) ans.

Si Rallia découvre ou a des motifs raisonnables de croire qu'un Compte a été créé ou utilisé par une personne de moins de dix-huit (18) ans, elle procédera à la résiliation immédiate de ce Compte et à la suppression des données associées, conformément à la Politique de confidentialité. Toute fausse déclaration relative à l'âge engage la seule responsabilité de l'Utilisateur, ou de son parent ou tuteur légal le cas échéant, à l'exclusion de toute responsabilité de Rallia.

2.  **Capacité juridique**

Vous devez avoir la capacité juridique de conclure un contrat contraignant en vertu des lois applicables dans votre juridiction. Si vous utilisez la Plateforme au nom d'une entité juridique, vous déclarez avoir l'autorité nécessaire pour lier cette entité aux présentes Conditions.

3.  **Absence de suspension antérieure**

Votre Compte ne doit pas avoir été préalablement suspendu ou résilié par Rallia en raison d'une violation des présentes Conditions. Toute tentative de créer un nouveau Compte après une résiliation constitue en elle-même une violation des présentes Conditions.

4.  **Absence de vérification des antécédents**

Rallia n'effectue aucune vérification des antécédents judiciaires ni aucune vérification d'identité de ses Utilisateurs. Vous reconnaissez et acceptez expressément ce fait et comprenez que toute interaction avec d'autres Utilisateurs sur la Plateforme ou lors de rencontres en personne se fait à vos propres risques. Rallia vous encourage à exercer votre jugement et à adopter en tout temps les pratiques de sécurité décrites à l'article 8 des présentes Conditions.

Rallia ne pourra en aucun cas être tenue responsable des actes, omissions, déclarations ou comportements d'autres Utilisateurs résultant, directement ou indirectement, de l'absence de vérification des antécédents.

5.  **Déclarations relatives aux antécédents judiciaires**

En accédant à la Plateforme et en créant un Compte, vous déclarez et garantissez expressément que vous n'avez pas été reconnu coupable d'une infraction criminelle grave, d'une infraction d'ordre sexuel ou d'une infraction impliquant la violence ou la menace de violence au sens du *Code criminel* du Canada ou d'une loi criminelle ou pénale équivalente dans toute autre juridiction. Vous déclarez également que vous n'êtes pas inscrit au Registre national des délinquants sexuels du Canada ni à tout registre équivalent dans toute autre juridiction.

Toute fausse déclaration à cet égard constitue un manquement grave aux présentes Conditions et entraîne la résiliation immédiate de votre Compte, sans préjudice de tout autre recours civil ou pénal dont dispose Rallia. Rallia se réserve le droit de signaler aux autorités compétentes toute situation dont elle aurait connaissance et qui laisserait croire qu'un Utilisateur a effectué de fausses déclarations en vertu du présent article.

### 4. Création et gestion du compte

Les fonctionnalités de la Plateforme nécessitent la création d'un Compte. Lors de la création de votre Compte, vous vous engagez à fournir des informations exactes, complètes et à jour, et à les maintenir ainsi tout au long de votre utilisation de la Plateforme. Toute information fausse ou incomplète peut entraîner la suspension ou la résiliation de votre Compte.

Votre Compte est strictement personnel. Vous ne pouvez pas céder votre Compte à un tiers, partager vos identifiants de connexion ni permettre à quiconque d'accéder à votre Compte en votre nom. Vous êtes seul responsable de la confidentialité de vos identifiants et de l'ensemble des activités effectuées depuis votre Compte, qu'elles aient été autorisées ou non par vous.

Vous devez aviser Rallia sans délai de tout accès non autorisé à votre Compte ou de toute autre atteinte à la sécurité de celui-ci, en nous contactant à l'adresse contact@rallia.ca. Rallia ne pourra être tenue responsable des pertes ou dommages résultant de l'utilisation non autorisée de vos identifiants lorsque vous avez manqué à votre obligation d'en assurer la confidentialité ou de nous aviser sans délai.

Rallia se réserve le droit de désactiver, modifier ou supprimer tout identifiant, qu'il ait été choisi par vous ou fourni par Rallia, à tout moment et pour tout motif, notamment en cas de violation des présentes Conditions.

### 5. Portail client et tableau de bord

1.  **Contenu et accès**

L'Application met à la disposition de tout Utilisateur titulaire d'un Compte un espace personnel (ci-après le « **Portail client** ») accessible depuis son tableau de bord. Le Portail client lui permet notamment d'accéder aux éléments suivants :

1.  L'historique des Parties auxquelles il a participé ou qu'il a organisées, ainsi que les Parties à venir qu'il a confirmées ;

2.  Les confirmations officielles de Parties, générées automatiquement par la Plateforme à la suite d'une inscription ou d'une création de Partie ;

3.  Ses reçus et l'historique de facturation liés à son abonnement ;

4.  Un répertoire des Parties publiques créées par les autres Utilisateurs, que l'Utilisateur peut explorer et rejoindre ;

5.  Le Répertoire de terrains, permettant à l'Utilisateur d'explorer les terrains de tennis et de pickleball répertoriés, d'en consulter les caractéristiques et les disponibilités et d'amorcer le processus de réservation auprès du gestionnaire du terrain concerné, tel que décrit à l'article 7.1 des présentes Conditions ;

6.  Un Répertoire de joueurs permettant à l'Utilisateur d'explorer et d'accéder au profil public des autres Utilisateurs inscrits sur la Plateforme ;

7.  Une messagerie intégrée permettant à l'Utilisateur d'échanger avec d'autres Utilisateurs, individuellement ou en groupe ;

8.  Toute autre fonctionnalité ou information que Rallia pourra rendre disponible dans le Portail client à sa seule discrétion, selon les modalités décrites à l'article 5.4 des présentes Conditions.

Rallia demeure propriétaire de l'interface du Portail client et de l'ensemble des données qui y transitent, sous réserve des droits que les Utilisateurs conservent sur leurs renseignements personnels conformément à la Politique de confidentialité.

2.  **Valeur des confirmations officielles**

Toute confirmation de Partie déposée dans le Portail client ou transmise à l'adresse courriel associée au Compte de l'Utilisateur vaut notification officielle et remise de document au sens des présentes Conditions. La confirmation est réputée reçue dès sa mise à disposition dans le Portail client ou dès son envoi par courriel, selon la première de ces éventualités.

Il appartient à l'Utilisateur de consulter régulièrement son Portail client et de maintenir son adresse courriel à jour dans les paramètres de son Compte. Rallia ne pourra être tenue responsable des conséquences découlant du défaut de l'Utilisateur de consulter ses confirmations ou de mettre à jour ses coordonnées, notamment en cas de litige relatif à une annulation ou à une absence à une Partie.

3.  **Messagerie interne**

Dans la mesure où la fonctionnalité de messagerie interne est activée sur la Plateforme, l'Utilisateur peut échanger des messages avec d'autres Utilisateurs directement depuis son Portail client. Cette fonctionnalité est mise à disposition à titre de service accessoire et son déploiement, sa modification ou sa suspension relèvent de la seule discrétion de Rallia.

L'utilisation de la messagerie interne est soumise à l'ensemble des obligations prévues à l'article 8 des présentes Conditions. Il est notamment interdit d'utiliser la messagerie interne à des fins commerciales ou publicitaires, pour solliciter d'autres Utilisateurs à des fins différentes que l'organisation de Parties, pour contourner les mécanismes de paiement intégrés à la Plateforme, ou pour tout échange contraire aux présentes Conditions ou aux lois applicables.

Rallia se réserve le droit d'accéder aux messages échangés via la messagerie interne dans la mesure permise par la loi applicable, notamment à des fins de sécurité, de prévention des abus ou de résolution de litiges entre Utilisateurs. L'Utilisateur ne doit pas avoir d'attente raisonnable de confidentialité absolue à l'égard des messages échangés sur la messagerie interne de la Plateforme.

4.  **Évolution du Portail client**

Le contenu, les fonctionnalités et les options disponibles dans le Portail client sont susceptibles d'être modifiés, élargis, restreints ou enrichis en tout temps, à la seule discrétion de Rallia. L'ajout de nouvelles fonctionnalités au Portail client ne constitue pas une modification importante des présentes Conditions et ne requiert pas de préavis distinct, sauf si ces nouvelles fonctionnalités emportent des obligations supplémentaires pour l'Utilisateur ou modifient ses droits de manière significative.

Rallia fera des efforts raisonnables pour informer les Utilisateurs des ajouts ou modifications importants apportés au Portail client, par voie de notification dans l'Application ou par courriel. L'utilisation continue du Portail client après toute modification vaut acceptation de celle-ci.

5.  **Disponibilité**

Rallia ne garantit pas la disponibilité continue et ininterrompue du Portail client. Des interruptions ponctuelles peuvent survenir notamment dans le cadre d'opérations de maintenance, de mises à jour techniques ou d'événements indépendants de la volonté de Rallia. Ces interruptions ne donnent droit à aucune indemnité ni à aucun remboursement. Les dispositions de l'article 16 des présentes Conditions s'appliquent pleinement au Portail client.

## NATURE DU SERVICE

### 6. Nature de la plateforme

Rallia est un intermédiaire technologique. Son rôle se limite à fournir une plateforme numérique permettant à des joueurs de tennis et de pickleball de se connecter entre eux, de trouver des partenaires de jeu, de faciliter la réservation de terrain, et d'organiser des Parties. Rallia n'est pas organisatrice de Parties et ne prend aucunement part aux activités sportives organisées via la Plateforme.

Rallia n'est pas partie aux interactions entre Utilisateurs. Elle ne sélectionne pas, ne supervise pas et ne contrôle pas le comportement des Utilisateurs sur le terrain ou lors de leurs rencontres en personne. Rallia ne garantit pas la présence, la ponctualité, le niveau de jeu réel, le comportement ni la fiabilité de quelque Utilisateur que ce soit.

Le Score de réputation et les badges affichés sur les profils d'Utilisateurs sont générés à partir des données fournies par les Utilisateurs eux-mêmes et des évaluations que ceux-ci se sont mutuellement attribuées. Ils constituent des indicateurs informatifs uniquement et ne représentent ni une garantie ni une certification de la part de Rallia quant au comportement futur d'un Utilisateur.

Vous reconnaissez et acceptez expressément que Rallia ne peut être tenue responsable des actes, omissions, comportements ou déclarations d'autres Utilisateurs, que ce soit sur la Plateforme ou lors de rencontres en personne.

### 7. Description des fonctionnalités

1.  **Répertoire de terrains (Court Finder)**

Le Répertoire de terrains permet de localiser des terrains de tennis et de pickleball à proximité de l'Utilisateur. Les informations relatives aux terrains sont issues, en tout ou en partie, de données communautaires fournies par les Utilisateurs ou de sources tierces. Rallia ne certifie pas l'exactitude, l'exhaustivité ni l'actualité de ces informations. Elle ne cautionne aucun des terrains répertoriés et ne garantit ni leur disponibilité ni les conditions d'accès à ceux-ci.

Lorsque le Répertoire de terrains redirige l'Utilisateur vers un site ou une plateforme tiers pour effectuer une réservation, Rallia n'est pas partie à cette transaction et n'assume aucune responsabilité à son égard. L'Utilisateur est seul responsable de s'assurer qu'il est autorisé à utiliser le terrain en question.

2.  **Espace de mise en relation entre joueurs (Game Marketplace)**

L’Espace de mise en relation entre joueurs permet à l'Utilisateur de créer des Parties ou d'en rejoindre, en précisant notamment le sport pratiqué, le format de jeu, le niveau requis, le lieu et les modalités de partage des frais. Il inclut un répertoire des Parties publiques regroupant l'ensemble des Parties publiques créées par les Utilisateurs, que tout Utilisateur peut explorer et rejoindre sous réserve des conditions fixées par le créateur de chaque Partie. Les règles applicables à l'organisation des Parties et au partage des frais sont précisées aux articles 9 et 10 des présentes Conditions.

3.  **Répertoire des joueurs**

Le Répertoire des joueurs permet à l'Utilisateur d'explorer et d'accéder au profil public de tous les autres Utilisateurs inscrits sur la Plateforme. Chaque Utilisateur peut y consulter les informations qu'un autre Utilisateur a choisi de rendre publiques. Les informations affichées dans le Répertoire des joueurs proviennent des Utilisateurs eux mêmes. Rallia n'en garantit ni l'exactitude ni l'actualité.

Le Répertoire des joueurs comprend deux sous fonctionnalités.

1.  **Groupes**

Les groupes permettent à un Utilisateur de créer ou de rejoindre un regroupement restreint de joueurs, limité à un maximum de vingt (20) membres, autour d'un centre d'intérêt commun tel qu'un cercle d'amis, une famille, un groupe de collègues ou tout autre affinité choisie par les membres. Les groupes sont privés. Ils ne sont pas visibles par les autres Utilisateurs de la Plateforme et l'adhésion se fait uniquement sur invitation d'un membre existant. Chaque groupe donne à ses membres un accès exclusif à un forum de discussion et à un répertoire de Parties privées réservé aux membres du groupe concerné.

2.  **Communautés**

Les communautés reposent sur les mêmes principes que les groupes mais peuvent accueillir un nombre illimité de membres autour d'un centre d'intérêt commun tel qu'une ville, une ligue, une école ou tout autre affinité choisie par les membres. Les communautés peuvent être publiques ou privées, à la discrétion de leur créateur ou de leurs modérateurs. Les communautés publiques sont visibles par tous les Utilisateurs de la Plateforme, mais l'adhésion demeure soumise à l'approbation d'un modérateur. Les communautés privées ne sont pas visibles par les autres Utilisateurs et l'adhésion se fait uniquement sur invitation ou approbation d'un modérateur.

3.  **Modération et responsabilité**

Le contenu publié dans les forums de discussion des groupes et des communautés constitue du Contenu utilisateur au sens de l'article 13 des présentes Conditions. Le créateur et les modérateurs d'un groupe ou d'une communauté sont responsables de la modération du contenu publié dans leur espace respectif. Rallia n'assume aucune responsabilité à l'égard du contenu publié par les Utilisateurs dans les groupes et communautés, sous réserve de son droit d'intervention prévu à l'article 13.4 des présentes Conditions.

4.  **Niveaux de jeu certifiés (Verified Skill Levels)**

Cette fonctionnalité permet à l'Utilisateur d'indiquer et de faire reconnaître son niveau de jeu selon les échelles NTRP ou DUPR, par la soumission d'une preuve vidéo ou de références d'autres Utilisateurs. Cette certification repose entièrement sur les informations fournies par l'Utilisateur et ne constitue pas une évaluation indépendante réalisée par Rallia. Rallia n'est affiliée à aucun des organismes qui administrent les échelles NTRP ou DUPR et n'en cautionne aucun. Les règles applicables à la certification du niveau de jeu sont précisées à l'article 8 des présentes Conditions.

5.  **Score de réputation**

Le Score de réputation attribue à chaque Utilisateur un indicateur et des badges (Bronze, Argent, Or, Platine) calculés selon les critères décrits à l'article 14 des présentes Conditions. Rallia se réserve le droit de modifier ces critères à tout moment. Toute modification substantielle sera communiquée aux Utilisateurs selon les modalités prévues à l'article 22 des présentes Conditions.

## UTILISATION DE LA PLATEFORME

### 8. Obligations générales de l'Utilisateur

En utilisant la Plateforme, vous vous engagez à respecter l'ensemble des lois et règlements applicables, notamment les lois de la province de Québec et les lois fédérales du Canada.

Sans limiter la portée générale de ce qui précède, vous vous engagez à ne pas faire ce qui suit :

1.  Effectuer de fausses déclarations concernant votre identité, votre niveau de jeu ou toute autre information pertinente sur votre profil ou lors de l'utilisation de la Plateforme ;

2.  Harceler, menacer, intimider ou porter atteinte aux droits d'autres Utilisateurs, que ce soit sur la Plateforme ou lors de rencontres en personne ;

3.  Utiliser la Plateforme à des fins commerciales, publicitaires ou de sollicitation sans l'accord préalable écrit de Rallia, notamment pour recruter des Utilisateurs vers une plateforme ou un service concurrent ;

4.  Diriger des échanges ou des transactions liés aux Parties ou à toute activité couverte par la Plateforme vers des canaux extérieurs à celle-ci, tels que WhatsApp, Telegram, courriel ou messagerie texte, lorsque ces échanges ont pour objet de contourner les fonctionnalités ou les mécanismes de paiement intégrés à la Plateforme ;

5.  Envoyer ou solliciter de l'argent, des cryptomonnaies, des cartes-cadeaux ou toute autre valeur monétaire à d'autres Utilisateurs en dehors des mécanismes de paiement intégrés à la Plateforme ;

6.  Publier, téléverser ou partager sur la Plateforme tout contenu diffamatoire, obscène, haineux, violent, discriminatoire ou portant atteinte aux droits d'un tiers, notamment ses droits d'auteur, son droit à la vie privée ou son droit à l'image ;

7.  Introduire des virus, logiciels malveillants, chevaux de Troie ou tout autre élément nuisible au fonctionnement de la Plateforme ou des systèmes d'autres Utilisateurs ;

8.  Tenter d'accéder de manière non autorisée à tout système, base de données ou Compte lié à la Plateforme, notamment par ingénierie inverse, décompilation ou désassemblage ;

9.  Utiliser des robots, araignées logiciels (web crawler) ou tout autre outil automatisé pour extraire des données de la Plateforme sans le consentement écrit préalable de Rallia ;

10. Utiliser la Plateforme d'une manière susceptible de nuire à la réputation de Rallia ou d'exposer Rallia à une responsabilité civile ou pénale.

Rallia se réserve le droit de surveiller l'utilisation de la Plateforme dans la mesure permise par la loi applicable, et d'enregistrer les interactions des Utilisateurs à des fins de sécurité, de conformité et d'amélioration du service.

**Recommandations de sécurité**

Compte tenu de la nature de la Plateforme, qui implique des rencontres en personne entre des individus qui ne se connaissent pas nécessairement, Rallia recommande aux Utilisateurs d'adopter en tout temps les pratiques suivantes :

1.  Rencontrer d'autres Utilisateurs dans des lieux publics ;

2.  Informer une personne de confiance de leurs plans avant de se rendre à une Partie organisée via la Plateforme ;

3.  Ne jamais divulguer à d'autres Utilisateurs des informations personnelles sensibles telles qu'une adresse domiciliaire, des informations financières ou des données de santé ;

4.  Signaler immédiatement à Rallia tout comportement suspect, inapproprié ou potentiellement dangereux à l'adresse contact@rallia.ca;

5.  Composer le 911 en cas de danger immédiat.

Ces recommandations sont fournies à titre informatif uniquement. Leur application par l'Utilisateur ne diminue en rien la responsabilité exclusive de celui-ci à l'égard de sa propre sécurité lors des rencontres en personne organisées via la Plateforme.

**Mise en garde contre les escroqueries**

Rallia ne vous demandera jamais de déplacer une conversation ou une transaction en dehors de la Plateforme. Toute sollicitation en ce sens émanant d'un autre Utilisateur doit être considérée comme suspecte et signalée immédiatement à Rallia à l'adresse contact@rallia.ca.

Il vous est strictement interdit d'envoyer ou de solliciter de l'argent, des cryptomonnaies, des cartes-cadeaux ou tout autre instrument de valeur monétaire à d'autres Utilisateurs par tout moyen autre que les mécanismes de paiement intégrés à la Plateforme. Rallia ne sera jamais responsable des pertes financières résultant d'une transaction effectuée en dehors de ces mécanismes.

**Retours et suggestions**

Si vous transmettez à Rallia des commentaires, suggestions ou idées d'amélioration relatifs à la Plateforme, vous accordez à Rallia une licence perpétuelle, mondiale, non exclusive et sans redevance pour utiliser ces contributions à toutes fins liées au développement de la Plateforme, sans obligation d'en créditer la source ni de vous verser une contrepartie.

### 9. Certification du niveau de jeu

La fonctionnalité de certification du niveau de jeu repose sur l'honnêteté et la bonne foi des Utilisateurs. En soumettant une demande de certification, vous déclarez et garantissez que les informations fournies, notamment les preuves vidéo, sont exactes, authentiques et vous concernent personnellement.

La certification est attribuée automatiquement dès la soumission d'une vidéo par l'Utilisateur. Rallia n'effectue aucune analyse humaine ni aucune vérification automatisée du contenu des vidéos soumises. Les vidéos de certification sont rendues accessibles aux autres Utilisateurs de la Plateforme, qui peuvent y associer des indicateurs d'appréciation. Ces indicateurs sont fournis à titre informatif uniquement et ne constituent pas une validation du niveau de jeu par Rallia.

En soumettant une vidéo de certification, vous acceptez expressément qu'elle soit visible par les autres Utilisateurs de la Plateforme et que ceux-ci puissent y associer des indicateurs d'appréciation. Vous déclarez disposer de tous les droits nécessaires sur le contenu de la vidéo soumise, et garantissez qu'elle ne porte pas atteinte aux droits d'un tiers.

Il est strictement interdit de soumettre une vidéo qui ne vous représente pas, d'usurper le niveau de jeu d'un tiers ou d'obtenir une certification par tout autre moyen frauduleux. Toute fausse déclaration relative à votre niveau de jeu constitue un manquement grave aux présentes Conditions susceptible d'entraîner la révocation immédiate de la certification, une dégradation de votre Score de réputation, la suspension ou la résiliation définitive de votre Compte, sans préjudice de tout autre recours dont dispose Rallia.

Rallia se réserve le droit de retirer ou de modifier la certification d'un Utilisateur si elle a des motifs raisonnables de croire que les informations ayant servi à l'établir sont inexactes ou frauduleuses. Cette décision peut être prise sans obligation de préavis et sans indemnité.

La certification d'un niveau de jeu sur la Plateforme ne constitue pas une reconnaissance officielle par un organisme sportif et ne confère aucun droit ni aucune accréditation au sens des règles d'associations telles que Tennis Canada, Pickleball Canada ou leurs affiliés.

### 10. Organisation de parties et code de conduite sportif

Tout Utilisateur qui crée ou rejoint une Partie via l’Espace de mise en relation entre joueurs s'engage à honorer sa participation. Plus précisément, vous vous engagez à ce qui suit :

1.  Vous présenter à l'heure et au lieu convenus pour toute Partie que vous avez confirmée ;

2.  Respecter les règles du sport pratiqué ainsi que les règles d'utilisation du terrain ;

3.  Adopter un comportement fair-play, respectueux et conforme à l'esprit sportif envers l'ensemble des participants, avant, pendant et après la Partie ;

4.  Signaler à Rallia tout comportement inapproprié, menaçant ou contraire aux présentes Conditions de la part d'un autre Utilisateur, à l'adresse contact@rallia.ca;

5.  Respecter les modalités de partage des frais convenues au moment de la création ou de l'adhésion à la Partie.

Une absence non justifiée ou une annulation effectuée après le délai prévu au moment de la création de la Partie constitue un manquement aux présentes Conditions. Selon la gravité ou la répétition du manquement, Rallia peut, à sa seule discrétion, dégrader le Score de réputation de l'Utilisateur concerné, restreindre temporairement ou définitivement son accès à l’Espace de mise en relation entre joueurs, ou procéder à la résiliation de son Compte.

Rallia n'est pas partie aux Parties organisées via l’Espace de mise en relation entre joueurs. Elle ne peut être tenue responsable de l'annulation d'une Partie, de l'absence ou du comportement d'un Utilisateur, de blessures ou dommages survenus lors d'une Partie, ni de tout différend entre Utilisateurs relatif au déroulement d'une Partie.

## PAIEMENTS ET ABONNEMENTS

### 11. Paiements

Les seuls paiements traités directement par Rallia au lancement de la Plateforme sont les frais d'abonnement au volet premium décrits à l'article 12 des présentes Conditions. Le partage des frais de terrain entre Utilisateurs dans le cadre de l'organisation de Parties s'effectue directement entre les participants, en dehors de la Plateforme. Rallia n'est pas partie à ces transactions et n'assume aucune responsabilité à leur égard.

Tous les montants affichés sur la Plateforme sont en dollars canadiens. La taxe sur les produits et services (TPS) et la taxe de vente du Québec (TVQ) s'ajoutent, le cas échéant, conformément aux lois fiscales applicables.

Rallia accepte les modes de paiement suivants pour les abonnements : Visa, Mastercard, Apple Pay, Google Pay, ainsi que les achats intégrés via l'App Store d'Apple et le Google Play Store de Google. Rallia se réserve le droit d'ajouter, de modifier ou de retirer tout mode de paiement en tout temps, moyennant un préavis raisonnable affiché sur la Plateforme.

1.  **Erreurs de facturation**

Si vous croyez qu'un montant vous a été facturé par erreur, vous devez en aviser Rallia par écrit à l'adresse contact@rallia.ca dans un délai de quinze (15) jours suivant la date de facturation. À défaut de nous aviser dans ce délai, le montant facturé sera réputé accepté par vous, et vous renoncez à tout recours à cet égard.

Des frais administratifs de deux cents dollars (200$), plus taxes applicables, peuvent s'appliquer à toute rétrofacturation (chargeback) initiée auprès de votre institution financière et jugée non fondée à la suite de l'examen du dossier par Rallia. Si la contestation est jugée non fondée, Rallia se réserve le droit de réclamer les sommes dues par toute voie de droit appropriée.

### 12. Abonnements

1.  **Niveaux d'accès**

La Plateforme est actuellement offerte gratuitement (ci-après le « **Forfait gratuit** »). Le Forfait gratuit donne accès aux fonctionnalités de la Plateforme sans frais. Rallia se réserve le droit de modifier les fonctionnalités incluses dans le Forfait gratuit en tout temps, moyennant un préavis raisonnable.

Rallia se réserve le droit d'introduire ultérieurement un ou plusieurs forfaits payants, en contrepartie du paiement de frais d'abonnement. Les modalités applicables à tout forfait payant seront communiquées aux Utilisateurs avant leur entrée en vigueur et intégrées aux présentes Conditions par voie de modification effectuée conformément à l'article 22.

## CONTENU ET RÉPUTATION

### 13. Contenu généré par l'utilisateur

Vous êtes seul et entièrement responsable du Contenu utilisateur que vous publiez, téléversez ou partagez sur la Plateforme. En soumettant du Contenu utilisateur, vous déclarez et garantissez que vous disposez de tous les droits nécessaires pour le publier, que ce contenu est exact et licite, et qu'il ne viole pas les droits d'un tiers, notamment les droits d'auteur, le droit à la vie privée ou le droit à l'image.

1.  **Licence accordée à Rallia**

En soumettant du Contenu utilisateur, vous accordez à Rallia une licence non exclusive, mondiale, sans redevance, sous-licenciable et transférable, pour utiliser, reproduire, adapter, distribuer, afficher publiquement et mettre en valeur ce Contenu, dans la seule mesure nécessaire à l'exploitation, au développement et à la promotion de la Plateforme. Cette licence prend fin lorsque vous supprimez le Contenu concerné de la Plateforme ou lorsque votre Compte est clôturé, sous réserve des copies déjà en circulation dans le cadre de l'exploitation normale de la Plateforme et des sauvegardes techniques.

Vous conservez la pleine propriété de votre Contenu utilisateur. Rallia ne revendique aucun droit de propriété sur celui-ci.

2.  **Droits moraux**

Dans la mesure permise par la *Loi sur le droit d'auteur* (Canada), vous renoncez à votre droit à la paternité de l'œuvre pour tout usage effectué par Rallia dans le cadre de la licence prévue à l'article 13.1, et ce uniquement aux fins d'exploitation de la Plateforme. Vous conservez l'intégralité de vos droits moraux pour tout usage qui excéderait la portée de cette licence

3.  **Photographies et vidéos**

En téléversant une photographie ou une vidéo sur la Plateforme, notamment à titre de photo de profil ou de preuve de certification de niveau de jeu, vous accordez à Rallia une licence mondiale, non exclusive et sans redevance pour utiliser, modifier, adapter, reproduire, distribuer et afficher ce contenu, en tout ou en partie, aux fins de promotion et d'exploitation de la Plateforme de Rallia uniquement. Cette licence demeure en vigueur pour la durée de votre Compte et pour une période raisonnable suivant sa clôture, afin de permettre à Rallia de retirer progressivement ce contenu de ses supports de communication. Elle ne confère à Rallia aucun droit d'utiliser ce contenu à des fins commerciales au bénéfice de tiers.

Vous déclarez disposer de tous les droits nécessaires sur les photographies et vidéos que vous téléversez, et garantissez qu'elles ne portent pas atteinte aux droits d'un tiers.

4.  **Modération du Contenu**

Rallia se réserve le droit, sans y être obligée, de surveiller, réviser, modifier, refuser de publier ou retirer tout Contenu utilisateur, en tout temps et pour tout motif, notamment si elle estime raisonnablement que ce contenu viole les présentes Conditions, porte atteinte aux droits d'un tiers ou est susceptible d'exposer Rallia à une responsabilité. Ce droit de modération ne crée pas pour Rallia une obligation de surveiller l'ensemble du Contenu utilisateur ni une responsabilité à l'égard du contenu qu'elle n'aurait pas retiré.

Rallia ne peut être tenue responsable du Contenu utilisateur publié par des tiers sur la Plateforme, que ce contenu soit exact, complet, à jour ou non.

### 14. Score de réputation et évaluations

Le Score de réputation est calculé automatiquement à partir des données d'utilisation de la Plateforme, notamment la ponctualité aux Parties, le nombre et la fréquence des annulations, ainsi que les évaluations laissées par d'autres Utilisateurs. Les badges Bronze, Argent, Or et Platine sont attribués selon des seuils définis par Rallia et susceptibles d'être modifiés.

Les évaluations soumises par les Utilisateurs constituent du Contenu utilisateur au sens de l'article 13 des présentes Conditions. Pour être valide, une évaluation doit respecter l'ensemble des critères suivants :

1.  Elle doit être fondée sur une expérience directe et personnelle avec l'Utilisateur évalué ;

2.  Elle ne peut contenir de propos discriminatoires, injurieux, diffamatoires ou haineux ;

3.  Elle ne peut formuler de conclusions sur la légalité du comportement d'un autre Utilisateur ;

4.  Elle ne peut être soumise dans le cadre d'une campagne organisée visant à améliorer ou à dégrader le Score de réputation d'un Utilisateur, qu'elle soit positive ou négative ;

5.  Elle ne peut émaner d'un Utilisateur affilié à un concurrent de la Plateforme dans le but de nuire à un autre Utilisateur ou à Rallia.

Toute tentative de manipulation du Score de réputation, que ce soit par la soumission d'évaluations fictives, la coordination entre Utilisateurs à des fins frauduleuses ou tout autre moyen, constitue un manquement grave aux présentes Conditions et peut entraîner la résiliation immédiate du Compte des Utilisateurs impliqués après enquête raisonnable de Rallia.

Rallia se réserve le droit de retirer toute évaluation qu'elle juge, à sa seule discrétion, contraire aux présentes Conditions ou susceptible de causer un préjudice injustifié à un Utilisateur, en vous en avisant, sans obligation de motiver sa décision. Ce droit de retrait ne fait pas de Rallia une partie responsable des évaluations publiées sur la Plateforme.

## PROPRIÉTÉ INTELLECTUELLE

### 15. Propriété intellectuelle de Rallia

La Plateforme et l'ensemble de ses composantes, y compris, sans s'y limiter, son code source, son architecture, ses interfaces, ses textes, ses graphiques, ses logos, ses icônes, ses algorithmes, ses bases de données et ses fonctionnalités, sont la propriété exclusive de Rallia ou de ses concédants de licence, et sont protégés par la *Loi sur le droit d'auteur* (Canada), la *Loi sur les marques de commerce* (Canada) et les autres lois applicables en matière de propriété intellectuelle au Canada.

Les présentes Conditions ne vous confèrent aucun droit de propriété sur la Plateforme ou sur l'une quelconque de ses composantes. Vous bénéficiez uniquement d'un droit d'accès et d'utilisation limité, personnel, non exclusif, non transférable et révocable, strictement aux fins prévues par les présentes Conditions.

Il vous est notamment interdit de reproduire, distribuer, modifier, adapter, traduire, créer des œuvres dérivées, décompiler, désassembler ou autrement tenter d'extraire le code source de la Plateforme ou de l'une quelconque de ses composantes, sans le consentement écrit préalable de Rallia. Toute utilisation non autorisée de la propriété intellectuelle de Rallia peut engager votre responsabilité civile et, le cas échéant, pénale.

Les marques de commerce, noms commerciaux, logos et autres signes distinctifs de Rallia affichés sur la Plateforme sont la propriété exclusive de Rallia. Aucune disposition des présentes Conditions ne vous confère le droit d'utiliser ces signes à quelque fin que ce soit sans le consentement écrit préalable de Rallia.

## RESPONSABILITÉ

### 16. Exclusions et limitations de responsabilité

1.  **Plateforme fournie « telle quelle »**

La Plateforme est fournie par Rallia « telle quelle » et « selon disponibilité », sans aucune garantie expresse ou implicite de quelque nature que ce soit, notamment quant à son exactitude, son exhaustivité, sa fiabilité, son adéquation à un usage particulier ou son fonctionnement ininterrompu. Rallia ne garantit pas que la Plateforme sera exempte d'erreurs, de virus ou d'autres éléments nuisibles, ni que les défaillances techniques seront corrigées dans un délai déterminé.

Dans la mesure permise par la loi applicable, Rallia décline toute responsabilité pour les dommages directs, indirects, accessoires, spéciaux, consécutifs ou punitifs résultant de l'utilisation ou de l'impossibilité d'utiliser la Plateforme, même si Rallia a été informée de la possibilité de tels dommages.

2.  **Activités sportives et rencontres en personne**

La pratique du tennis et du pickleball comporte des risques inhérents de blessures physiques. En utilisant la Plateforme pour organiser ou rejoindre une Partie, vous reconnaissez et acceptez ces risques et dégagez expressément Rallia de toute responsabilité à l'égard de blessures, de dommages matériels ou de tout autre préjudice survenu lors d'une Partie organisée via la Plateforme. Cette exclusion ne s'applique pas dans les cas où la responsabilité de Rallia est engagée par sa propre faute lourde ou intentionnelle, ni dans les cas où la Loi en interdit l'exclusion.

De même, toute rencontre en personne avec un autre Utilisateur se fait à vos propres risques. Rallia ne peut être tenue responsable du comportement d'un Utilisateur lors de telles rencontres, quelle qu'en soit la nature.

3.  **Contenu de tiers et Répertoire de terrains**

Rallia n'est pas responsable de l'exactitude ou de la disponibilité des informations relatives aux terrains figurant dans le Répertoire de terrains, ni du contenu des sites ou plateformes tiers vers lesquels la Plateforme redirige l'Utilisateur. L'accès à ces ressources tierces se fait sous la seule responsabilité de l'Utilisateur et est soumis aux conditions d'utilisation de ces tiers.

4.  **Plafond de responsabilité**

Dans la mesure maximale permise par la loi applicable, la responsabilité totale cumulée de Rallia à votre égard, pour toute réclamation découlant des présentes Conditions ou de votre utilisation de la Plateforme, est limitée au montant total que vous avez effectivement versé à Rallia au cours des douze (12) mois précédant l'événement donnant lieu à la réclamation, ou à cent (100) dollars canadiens si vous n'avez effectué aucun paiement au cours de cette période.

Cette limitation de responsabilité ne s'applique pas dans les cas où la loi applicable en interdit l'exclusion, notamment en cas de fraude, de faute intentionnelle ou de faute lourde de la part de Rallia.

### 17. Indemnisation par l'Utilisateur

Vous vous engagez à défendre, indemniser et dégager de toute responsabilité Rallia, ses administrateurs, dirigeants, employés, mandataires, actionnaires et sous-traitants, à l'égard de toute réclamation, poursuite, perte, dommage, jugement, dépense ou frais, incluant les honoraires judiciaires et dépens, les honoraires extrajudiciaires raisonnables (dont avocats), découlant de votre utilisation de la Plateforme, de votre violation des présentes Conditions, de votre violation des droits d'un tiers, de votre Contenu utilisateur, ou de votre participation à une Partie organisée via la Plateforme.

Rallia se réserve le droit d'assumer la défense et le contrôle exclusifs de toute affaire faisant l'objet d'une indemnisation de votre part, auquel cas vous vous engagez à coopérer pleinement avec Rallia dans la conduite de cette défense. Cet engagement d'indemnisation demeure en vigueur après la résiliation des présentes Conditions et la fermeture de votre Compte.

## VIE DU COMPTE

### 18. Données utilisateur

Rallia conserve les données que vous transmettez à la Plateforme dans le but d'assurer son fonctionnement et d'améliorer votre expérience utilisateur. Bien que Rallia effectue des sauvegardes périodiques de ses systèmes, ces sauvegardes sont réalisées à des fins opérationnelles et ne constituent pas une garantie de conservation de vos données personnelles ou de votre Contenu utilisateur.

Vous êtes seul responsable des données que vous transmettez à la Plateforme et de toute activité que vous effectuez via celle-ci. Rallia ne peut être tenue responsable de la perte, de la corruption ou de la suppression de vos données, quelle qu'en soit la cause, incluant une défaillance technique, une cyberattaque ou toute autre circonstance indépendante de sa volonté. Vous renoncez par les présentes à tout recours contre Rallia découlant de la perte ou de la corruption de vos données.

La suppression de votre Compte entraîne la suppression progressive de vos données personnelles conformément à la Politique de confidentialité de Rallia. Certaines données peuvent toutefois être conservées pour la durée requise par la loi applicable ou pour les besoins légitimes de Rallia, notamment pour la défense de ses droits en cas de litige.

### 19. Suspension et résiliation du compte

1.  **Résiliation à l'initiative de l'Utilisateur**

Vous pouvez fermer votre Compte à tout moment en vous connectant à votre Compte et en suivant la procédure de fermeture prévue dans les paramètres de l'Application ou du site web, ou en nous contactant à l'adresse contact@rallia.ca. La fermeture de votre Compte entraîne la perte d'accès à l'ensemble des fonctionnalités de la Plateforme ainsi que la suppression de vos données, conformément à la Politique de confidentialité de Rallia.

La fermeture de votre Compte ne vous donne pas droit au remboursement des frais déjà engagés, sauf dans les cas expressément prévus par la loi applicable.

2.  **Suspension ou résiliation par Rallia**

Rallia se réserve le droit de suspendre ou de résilier votre Compte pour l'une ou l'autre des raisons suivantes.

En cas de manquement grave, la suspension ou résiliation peut intervenir immédiatement et sans préavis. Constituent notamment des manquements graves les situations suivantes :

1.  Comportement frauduleux, notamment toute fausse déclaration relative à votre identité, votre âge ou votre niveau de jeu ;

2.  Comportement abusif, harcelant ou menaçant envers d'autres Utilisateurs ou envers des représentants de Rallia ;

3.  Utilisation de la Plateforme à des fins illégales ou contraires à l'ordre public ;

4.  Participation à la manipulation du Score de réputation ou du système d'évaluation ;

5.  Création d'un nouveau Compte après résiliation d'un Compte antérieur par Rallia.

En cas de manquement de moindre gravité, Rallia vous adressera un avis par courriel ou par notification dans l'Application, vous accordant un délai de quinze (15) jours pour remédier à la situation. À défaut de correction dans ce délai, Rallia pourra procéder à la suspension ou à la résiliation du Compte. Constituent notamment des manquements de moindre gravité les situations suivantes :

1.  Violation des présentes Conditions autre que celles visées ci-dessus ;

2.  Non-paiement de sommes dues à Rallia ;

3.  Inactivité prolongée du Compte, soit toute période d'inactivité supérieure à 12 mois ;

4.  Tout autre motif que Rallia estime raisonnablement justifié pour protéger l'intégrité de la Plateforme ou la sécurité de ses Utilisateurs.

La suspension peut être temporaire ou définitive, selon la gravité du manquement et l'appréciation de Rallia. En cas de résiliation pour violation des présentes Conditions, vous n'avez droit à aucun remboursement des frais déjà engagés, sauf dans les cas prévus par la Loi.

3.  **Effets de la résiliation**

La résiliation du Compte, qu'elle soit à votre initiative ou à celle de Rallia, entraîne la cessation immédiate de votre droit d'accéder à la Plateforme et de l'utiliser. Les dispositions des présentes Conditions qui, par leur nature, ont vocation à survivre à la résiliation demeureront en vigueur après celle-ci, notamment les articles 13 (Contenu généré par l'utilisateur), 15 (Propriété intellectuelle), 16 (Exclusions et limitations de responsabilité), 17 (Indemnisation) et 24 (Loi applicable et résolution des litiges).

## DISPOSITIONS FINALES

### 20. Protection des renseignements personnels

La collecte, l'utilisation, la conservation et la communication de vos renseignements personnels dans le cadre de votre utilisation de la Plateforme sont régies par la Politique de confidentialité de Rallia, disponible à l'adresse <https://www.rallia.ca/fr-CA/privacy>, laquelle est incorporée aux présentes Conditions par référence.

La Politique de confidentialité de Rallia est conforme aux exigences de la *Loi sur la protection des renseignements personnels dans le secteur privé* (Québec), ainsi qu'aux exigences de la *Loi sur la protection des renseignements personnels et les documents électroniques* (Québec). En acceptant les présentes Conditions, vous reconnaissez également avoir pris connaissance de la Politique de confidentialité et en accepter les termes.

### 21. Application mobile

L'Application est disponible sur l'App Store d'Apple Inc. et le Google Play Store de Google LLC (ci-après les « **Distributeurs** »). En téléchargeant ou en utilisant l'Application via l'une ou l'autre de ces plateformes, vous reconnaissez et acceptez ce qui suit.

Les présentes Conditions sont conclues entre vous et Rallia uniquement, et non entre vous et les Distributeurs. Les Distributeurs n'ont aucune obligation envers vous en vertu des présentes Conditions. La responsabilité des Distributeurs à l'égard de l'Application est strictement limitée à ce qui est prévu dans leurs propres conditions générales.

Si l'Application ne satisfait pas à une garantie applicable, vous pouvez en aviser le Distributeur concerné, lequel peut rembourser, le cas échéant, tout prix d'achat conformément à ses propres conditions. Dans la mesure maximale permise par la loi applicable, le Distributeur n'assume aucune autre obligation de garantie à l'égard de l'Application.

Vous vous engagez à respecter les conditions d'utilisation applicables du Distributeur concerné lors de votre utilisation de l'Application. Vous reconnaissez que les Distributeurs sont des tiers bénéficiaires des présentes Conditions et qu'ils ont le droit d'en faire respecter les termes à votre égard en cette qualité.

### 22. Modifications aux présentes conditions

Rallia se réserve le droit de modifier les présentes Conditions en tout temps. Toute modification sera communiquée aux Utilisateurs par la publication d'une version mise à jour sur la Plateforme, assortie d'une date de mise à jour révisée. En cas de modification substantielle, Rallia fera des efforts raisonnables pour vous en aviser par courriel ou par notification dans l'Application, dans un délai raisonnable avant l'entrée en vigueur de la modification.

Les Conditions applicables à votre utilisation de la Plateforme sont celles en vigueur au moment de cette utilisation. Le fait de continuer à utiliser la Plateforme après l'entrée en vigueur des Conditions modifiées vaut acceptation de celles-ci. Si vous n'acceptez pas les Conditions modifiées, vous devez cesser d'utiliser la Plateforme et fermer votre Compte.

### 23. Force majeure

Rallia ne peut être tenue responsable de tout retard ou manquement dans l'exécution de ses obligations lorsque ce retard ou ce manquement résulte d'un événement de force majeure, soit tout événement imprévisible, irrésistible et extérieur à sa volonté raisonnable, incluant notamment les pannes technologiques majeures, les cyberattaques, les catastrophes naturelles, les épidémies, les pandémies, les grèves, les décisions d'autorités gouvernementales ou toute autre circonstance échappant raisonnablement à son contrôle.

Dans un tel cas, Rallia en informe les Utilisateurs dans les meilleurs délais par tout moyen approprié, et ses obligations sont suspendues pour la durée de l'événement. Rallia reprend l'exécution de ses obligations dès que l'événement de force majeure cesse, sans que cette reprise ne constitue une reconnaissance de responsabilité pour la période de suspension. Si l'événement de force majeure se prolonge au-delà de trente (30) jours consécutifs, Rallia se réserve le droit de suspendre ou de modifier les fonctionnalités affectées de la Plateforme, sans qu'aucune indemnité ne puisse être réclamée à ce titre.

### 24. Loi applicable et résolution des litiges

1.  **Loi applicable**

Les présentes Conditions sont régies exclusivement par les lois de la province de Québec et les lois fédérales du Canada applicables, à l'exclusion de toute règle de conflit de lois qui pourrait conduire à l'application de la loi d'une autre juridiction.

2.  **Tentative de règlement amiable**

En cas de différend découlant des présentes Conditions ou de l'utilisation de la Plateforme, la partie qui souhaite initier un processus de règlement en avise l'autre partie par écrit, en précisant la nature du différend et la solution envisagée. Les parties disposent alors d'un délai de trente (30) jours suivant la réception de cet avis pour parvenir à un règlement à l'amiable, ce délai pouvant être prolongé d'un commun accord.

3.  **Compétence judiciaire**

À défaut de règlement amiable, tout litige découlant des présentes Conditions ou de l'utilisation de la Plateforme est soumis à la compétence des tribunaux du Québec, dans le district judiciaire de Montréal.

4.  **Mesures provisoires et conservatoires**

Rien dans le présent article n'empêche Rallia de demander une injonction ou toute autre mesure provisoire ou conservatoire devant tout tribunal compétent, lorsqu'elle l'estime nécessaire pour protéger ses droits, notamment en matière de propriété intellectuelle ou de violation grave des présentes Conditions. L'introduction d'une telle demande ne constitue pas une renonciation à l'obligation de médiation prévue à l'article 24.3.

### 25. Dispositions générales

1.  **Non-renonciation**

Le fait pour Rallia de ne pas exiger l'exécution d'une disposition des présentes Conditions ou de ne pas exercer un droit ou un recours auquel elle a droit ne constitue pas une renonciation à cette disposition, à ce droit ou à ce recours. Rallia conserve en tout temps le droit de se prévaloir de l'ensemble des présentes Conditions.

2.  **Divisibilité**

Si une disposition des présentes Conditions est jugée invalide, illégale ou inapplicable par un tribunal compétent, cette disposition sera réputée modifiée dans la mesure minimale nécessaire pour la rendre valide et applicable, dans le respect de l'intention originale des parties. Les autres dispositions des présentes Conditions demeurent pleinement en vigueur.

3.  **Cession**

Vous ne pouvez pas céder, transférer ou déléguer tout ou partie de vos droits ou obligations découlant des présentes Conditions sans le consentement écrit préalable de Rallia. Rallia peut céder les présentes Conditions, en tout ou en partie, sans votre consentement, notamment dans le cadre d'une fusion, d'une acquisition ou d'une vente de tout ou partie de ses actifs.

4.  **Langue**

Les présentes Conditions ont été rédigées en français conformément à la *Charte de la langue française* (Québec). Tout Utilisateur résidant au Québec a le droit de recevoir les présentes Conditions ainsi que tout document contractuel s'y rattachant en langue française. En cas de version dans une autre langue, la version française prévaut en cas de divergence.

5.  **Contrat formé par voie électronique**

Les présentes Conditions sont conclues par voie électronique. Conformément à la Loi, le contrat ainsi formé a la même valeur juridique qu'un contrat écrit sur support papier. L'acceptation des présentes Conditions par voie électronique, notamment par le fait de créer un Compte ou d'utiliser la Plateforme, constitue une signature électronique valide et lie l'Utilisateur au même titre qu'une signature manuscrite.

6.  **Confirmation par courriel**

La confirmation transmise par courriel à l'Utilisateur à la suite de son inscription sur la Plateforme, de la création d'une Partie ou de tout autre acte donnant lieu à la formation d'un contrat constitue la remise d'un exemplaire du contrat au sens de la *Loi sur la protection du consommateur* (Québec), dans la mesure où cette loi est applicable à la transaction concernée. Il appartient à l'Utilisateur de conserver cette confirmation à titre de preuve de la transaction.

7.  **Intégralité de l'entente**

Les présentes Conditions, la Politique de confidentialité de Rallia et, le cas échéant, toute politique ou règle spécifique publiée sur la Plateforme en lien avec une fonctionnalité particulière, constituent l'intégralité de l'entente entre vous et Rallia relativement à l'objet des présentes. Elles remplacent tout accord, communication ou représentation antérieur entre les parties à cet égard.

8.  **Interprétation des titres**

Les titres des articles et des sections des présentes Conditions sont insérés à titre de référence et de commodité uniquement. Ils ne font pas partie des Conditions et n'affectent ni leur portée ni leur interprétation.

### 26. Contactez-nous

Pour toute question relative aux présentes Conditions ou à votre utilisation de la Plateforme, vous pouvez nous joindre aux coordonnées suivantes :

**Rallia inc.**

203-5740, boulevard Cavendish

Côte-Saint-Luc (Québec) H4W 2T8

Téléphone : +1 514 601-4198

Courriel : contact@rallia.ca

Site web : rallia.ca
`,
};
