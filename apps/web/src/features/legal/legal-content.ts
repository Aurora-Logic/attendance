/**
 * The two legal documents, as structured copy rather than markup, so the
 * page draws them in one typographic system and a test can check every
 * section has a heading and a body.
 *
 * The wording is a working draft written from what the product actually
 * records and does (PRD: punches with photo and location, geofencing, the
 * photo retention purge, the recycle bin, the audit trail, the Tally
 * projection). It has not been reviewed by counsel; docs/OPEN-QUESTIONS.md
 * carries that, together with the legal entity's name and grievance
 * contact, which are the operator's to supply.
 */

export type LegalSlug = 'terms' | 'privacy';

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface LegalDocument {
  readonly slug: LegalSlug;
  readonly title: string;
  readonly lead: string;
  /** ISO date; shown as "Last updated". */
  readonly updatedOn: string;
  readonly sections: readonly LegalSection[];
}

export const LEGAL_SLUGS: readonly LegalSlug[] = ['terms', 'privacy'];

export function isLegalSlug(value: string): value is LegalSlug {
  return LEGAL_SLUGS.includes(value as LegalSlug);
}

const TERMS: LegalDocument = {
  slug: 'terms',
  title: 'Terms and Conditions',
  lead: 'The agreement between you, the organisation that gave you access, and the operator of Vyuha.',
  updatedOn: '2026-08-22',
  sections: [
    {
      heading: 'What Vyuha is',
      paragraphs: [
        'Vyuha is a business application for the organisation you work with. It records attendance, manages leave, holidays, shifts and approvals, keeps master data, and carries sales, purchase and customer records, some of which are mirrored from the organisation’s TallyPrime. Your organisation decides which of these it uses and who may see what.',
        'These terms apply whenever you sign in to Vyuha, on any device. By signing in you accept them. If you do not accept them, do not sign in.',
      ],
    },
    {
      heading: 'Your account',
      paragraphs: [
        'Accounts exist only by invitation from an administrator of your organisation. There is no public sign-up. Your organisation decides that you should have an account, what role you hold, and when the account is deactivated.',
        'Your password is yours. Do not share it, and do not sign in as anyone else. After five failed attempts an account is locked for fifteen minutes and the holder is told by email. Tell an administrator at once if you believe someone else knows your password.',
      ],
    },
    {
      heading: 'Your organisation’s role',
      paragraphs: [
        'Vyuha is provided to your organisation, which is the customer. Your organisation controls the data it records about you, sets the rules Vyuha applies — shift timings, grace, geofences, leave policies, approval chains — and is responsible for how those rules are used.',
        'Questions about a punch, a leave balance, a flag or a record about you go to your organisation’s administrators. Vyuha shows what was recorded; it does not decide what it means for your employment.',
      ],
    },
    {
      heading: 'Acceptable use',
      paragraphs: [
        'Use Vyuha only for your organisation’s work, only with your own account, and only as your role permits. Do not try to reach data your role does not show you, interfere with the service, or use it to record anything false — a punch for someone else, a photo that is not you, a location you are not at.',
        'Every change a person makes is written to an audit trail that names the person and the time. That trail is part of the record your organisation keeps.',
      ],
    },
    {
      heading: 'Availability and changes',
      paragraphs: [
        'The operator aims to keep Vyuha available and will tell your organisation about planned maintenance, but no service is available every minute of every day. A punch made while the service is unreachable is not lost if the device records it for later delivery, but you should tell an administrator about any day that looks wrong.',
        'Vyuha changes over time. Features are added, moved and occasionally removed, and these terms may change with them. The date at the top is when they last did; continuing to sign in after a change accepts the changed terms.',
      ],
    },
    {
      heading: 'Ownership',
      paragraphs: [
        'The software, its design and its name belong to the operator. The records it holds — your organisation’s employees, attendance, documents and master data — belong to your organisation. Nothing in these terms transfers either.',
      ],
    },
    {
      heading: 'Liability',
      paragraphs: [
        'Vyuha records and reports; it is not a payroll system and it does not calculate pay. Decisions about pay, leave, discipline or employment that use these records are your organisation’s, and the operator is not a party to them.',
        'To the extent the law allows, the operator is not liable for loss that follows from how your organisation uses these records, from data your organisation entered, or from events outside the operator’s control. Nothing here limits liability that the law does not allow to be limited.',
      ],
    },
    {
      heading: 'Ending access',
      paragraphs: [
        'Your organisation may deactivate your account at any time; deactivation ends your access but does not delete the records already made, which your organisation keeps for as long as its own policies and the law require. The operator may suspend access that is being misused.',
      ],
    },
    {
      heading: 'Law and contact',
      paragraphs: [
        'These terms are governed by the laws of India, and the courts of the operator’s registered place of business have jurisdiction.',
        'Questions about these terms go first to your organisation’s administrator. The operator’s contact details for matters the organisation cannot resolve are published with the Privacy Policy.',
      ],
    },
  ],
};

const PRIVACY: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy Policy',
  lead: 'What Vyuha records about you, why, who can see it, and for how long.',
  updatedOn: '2026-08-22',
  sections: [
    {
      heading: 'Who this covers',
      paragraphs: [
        'This policy covers everyone with a Vyuha account and everyone whose attendance or records an organisation keeps in it. Your organisation is the data fiduciary for those records under the Digital Personal Data Protection Act, 2023; the operator of Vyuha processes them on the organisation’s instructions.',
      ],
    },
    {
      heading: 'What is recorded',
      paragraphs: [
        'Who you are: your name, employee code, work email, mobile number, department, location, designation, reporting line and the dates of your employment, as your organisation enters them.',
        'Attendance: each punch with its time, whether it was in or out, how it was made (the app, a kiosk, or entered by an administrator), the photo taken at the punch, the device’s location and its stated accuracy, and for a web punch the network address it came from. From these Vyuha derives your day: present, late, early, half day, absent, overtime, and any flags and the reasons given for them.',
        'Leave and time: leave requests and balances, holidays, shifts and rosters, weekly offs, compensatory credits, and every approval or rejection with who decided it and when.',
        'Business records: if your role touches sales, purchase or customer work, the documents, parties and items you create or edit, and the fields mirrored from your organisation’s TallyPrime. These are business records, but they carry your name as the person who made them.',
        'Your session: a refresh token in a cookie that keeps you signed in, an access token held only in memory, and the time and address of each sign-in. Vyuha sets no advertising or tracking cookies.',
      ],
    },
    {
      heading: 'Why',
      paragraphs: [
        'To run attendance the way your organisation has configured it, to manage leave and approvals, to produce the registers, musters and reports your organisation needs, and to hand attendance inputs to payroll. Vyuha does not calculate pay.',
        'The photo and the location exist to confirm that a punch was made by you, where you were. They are not used for anything else, are not analysed for anything else, and are not shared outside your organisation.',
      ],
    },
    {
      heading: 'Who can see it',
      paragraphs: [
        'Access follows the role your organisation gave you. You see your own records; managers see their teams; administrators see the organisation. Every screen and every export is limited to what the viewer’s role permits, and the same limits apply to the reports and files that leave the system.',
        'The operator’s staff do not browse your organisation’s records. They may see them when your organisation asks for support, and that access is logged.',
        'Data is not sold and is not shared with advertisers. It is shared only with the services needed to run Vyuha — hosting, email delivery, file storage — on terms that bind them to this policy, and with your organisation’s own TallyPrime where your organisation has connected it.',
      ],
    },
    {
      heading: 'How long it is kept',
      paragraphs: [
        'Punch photos are kept for the period your organisation sets, twelve months unless changed, and are then deleted by a scheduled purge that warns administrators before it runs. The punch itself, without the photo, stays as part of the attendance record.',
        'Records your organisation deletes go to a recycle bin for a set window, after which they are gone. The audit trail that says who changed what is kept as long as the organisation’s account exists, because it is the record of the record.',
        'Attendance and leave records are kept for as long as your organisation’s own policies and Indian law require, which your organisation decides.',
      ],
    },
    {
      heading: 'How it is protected',
      paragraphs: [
        'Passwords are stored only as salted hashes. Every connection is encrypted. Access is checked on the server for every request, never only on the screen. Repeated failed sign-ins lock the account. The operator keeps backups and tests that they restore.',
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'You may ask to see the personal data held about you, to have a mistake corrected, and — subject to the records your organisation must keep by law — to have data erased. Make the request to your organisation’s administrator, who is responsible for answering it; Vyuha gives administrators the tools to do so.',
        'If your organisation does not resolve a request, you may raise it with the operator’s grievance officer at the contact below, and after that with the Data Protection Board of India.',
      ],
    },
    {
      heading: 'Changes and contact',
      paragraphs: [
        'This policy changes when the product changes what it records. The date at the top is when it last did, and your organisation’s administrators are told of material changes.',
        'The operator’s legal name, address and grievance officer contact are published by the operator to each organisation it serves; ask your administrator for them.',
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: Readonly<Record<LegalSlug, LegalDocument>> = { terms: TERMS, privacy: PRIVACY };
