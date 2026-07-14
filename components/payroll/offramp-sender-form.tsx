"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

type SenderProfile = {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  countryOrigin: string;
  addressLineOne?: string | null;
  addressLineTwo?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  zipCode?: string | null;
  phoneNumber?: string | null;
  nationality?: string | null;
  nationalIdentityNumber?: string | null;
  dob?: string | null;
  placeOfBirth?: string | null;
  sourceOfFunds: string;
  email?: string | null;
};

const EMPTY: SenderProfile = {
  firstName: "",
  middleName: "",
  lastName: "",
  countryOrigin: "",
  addressLineOne: "",
  addressLineTwo: "",
  city: "",
  province: "",
  country: "",
  zipCode: "",
  phoneNumber: "",
  nationality: "",
  nationalIdentityNumber: "",
  dob: "",
  placeOfBirth: "",
  sourceOfFunds: "",
  email: "",
};

export const SOURCE_OF_FUNDS_OPTIONS = [
  "Compensation",
  "Sale/Income from Property",
  "Business Income",
  "Pension/Benefit from the Government",
  "Gift/Donation",
  "Sale/Income from Investment",
  "Inheritance/Insurance",
];

export const COUNTRY_OPTIONS = [
  "Philippines",
  "Afghanistan",
  "Albania",
  "Algeria",
  "Andorra",
  "Angola",
  "Antigua and Barbuda",
  "Argentina",
  "Armenia",
  "Australia",
  "Austria",
  "Azerbaijan",
  "Bahamas",
  "Bahrain",
  "Bangladesh",
  "Barbados",
  "Belarus",
  "Belgium",
  "Belize",
  "Benin",
  "Bhutan",
  "Bolivia",
  "Bosnia and Herzegovina",
  "Botswana",
  "Brazil",
  "Brunei",
  "Bulgaria",
  "Burkina Faso",
  "Burundi",
  "Cambodia",
  "Cameroon",
  "Canada",
  "Cabo Verde",
  "Central African Republic",
  "Chad",
  "Chile",
  "China",
  "Colombia",
  "Comoros",
  "Congo",
  "Costa Rica",
  "Croatia",
  "Cuba",
  "Cyprus",
  "Czech Republic",
  "Democratic Republic of the Congo",
  "Denmark",
  "Djibouti",
  "Dominica",
  "Dominican Republic",
  "East Timor",
  "Ecuador",
  "Egypt",
  "El Salvador",
  "Equatorial Guinea",
  "Eritrea",
  "Estonia",
  "Eswatini",
  "Ethiopia",
  "Fiji",
  "Finland",
  "France",
  "Gabon",
  "Gambia",
  "Georgia",
  "Germany",
  "Ghana",
  "Greece",
  "Grenada",
  "Guatemala",
  "Guinea",
  "Guinea-Bissau",
  "Guyana",
  "Haiti",
  "Honduras",
  "Hungary",
  "Iceland",
  "India",
  "Indonesia",
  "Iran",
  "Iraq",
  "Ireland",
  "Israel",
  "Italy",
  "Jamaica",
  "Japan",
  "Jordan",
  "Kazakhstan",
  "Kenya",
  "Kiribati",
  "Kuwait",
  "Kyrgyzstan",
  "Laos",
  "Latvia",
  "Lebanon",
  "Lesotho",
  "Liberia",
  "Libya",
  "Liechtenstein",
  "Lithuania",
  "Luxembourg",
  "Madagascar",
  "Malawi",
  "Malaysia",
  "Maldives",
  "Mali",
  "Malta",
  "Marshall Islands",
  "Mauritania",
  "Mauritius",
  "Mexico",
  "Micronesia",
  "Moldova",
  "Monaco",
  "Mongolia",
  "Montenegro",
  "Morocco",
  "Mozambique",
  "Myanmar",
  "Namibia",
  "Nauru",
  "Nepal",
  "Netherlands",
  "New Zealand",
  "Nicaragua",
  "Niger",
  "Nigeria",
  "North Korea",
  "North Macedonia",
  "Norway",
  "Oman",
  "Pakistan",
  "Palau",
  "Palestine",
  "Panama",
  "Papua New Guinea",
  "Paraguay",
  "Peru",
  "Poland",
  "Portugal",
  "Qatar",
  "Romania",
  "Russia",
  "Rwanda",
  "Saint Kitts and Nevis",
  "Saint Lucia",
  "Saint Vincent and the Grenadines",
  "Samoa",
  "San Marino",
  "Sao Tome and Principe",
  "Saudi Arabia",
  "Senegal",
  "Serbia",
  "Seychelles",
  "Sierra Leone",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "Solomon Islands",
  "Somalia",
  "South Africa",
  "South Korea",
  "South Sudan",
  "Spain",
  "Sri Lanka",
  "Sudan",
  "Suriname",
  "Sweden",
  "Switzerland",
  "Syria",
  "Taiwan",
  "Tajikistan",
  "Tanzania",
  "Thailand",
  "Togo",
  "Tonga",
  "Trinidad and Tobago",
  "Tunisia",
  "Turkey",
  "Turkmenistan",
  "Tuvalu",
  "Uganda",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Uruguay",
  "Uzbekistan",
  "Vanuatu",
  "Vatican City",
  "Venezuela",
  "Vietnam",
  "Yemen",
  "Zambia",
  "Zimbabwe",
];

export default function OffRampSenderForm({ deploymentId }: { deploymentId: string }) {
  const [profile, setProfile] = useState<SenderProfile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch(`/api/deployments/${deploymentId}/offramp-sender`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load sender profile");
        const json = (await res.json()) as { data: { profile: SenderProfile | null } };
        if (json.data.profile) {
          setProfile({ ...EMPTY, ...json.data.profile });
        }
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [deploymentId]);

  const update = (patch: Partial<SenderProfile>) => {
    setProfile((prev) => ({ ...prev, ...patch }));
  };

  const save = async () => {
    if (!profile.firstName.trim() || !profile.lastName.trim() || !profile.sourceOfFunds.trim()) {
      toast.error("First name, last name, and source of funds are required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/deployments/${deploymentId}/offramp-sender`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: profile.firstName,
          middleName: profile.middleName || undefined,
          lastName: profile.lastName,
          countryOrigin: profile.countryOrigin,
          sourceOfFunds: profile.sourceOfFunds,
        }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? "Failed to save sender profile");
      }
      toast.success("Sender KYC saved");
    } catch (err) {
      toast.error((err as Error).message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-on-surface-variant py-4 text-center font-mono text-xs">
        Loading sender KYC…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-label-sm text-on-surface-variant font-mono uppercase">
          Sender KYC
        </span>
        <span className="material-symbols-outlined text-on-surface-variant">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <input
              className="input"
              placeholder="First name *"
              value={profile.firstName}
              onChange={(e) => update({ firstName: e.target.value })}
            />
            <input
              className="input"
              placeholder="Middle name (n.a. if none)"
              value={profile.middleName ?? ""}
              onChange={(e) => update({ middleName: e.target.value })}
            />
            <input
              className="input"
              placeholder="Last name *"
              value={profile.lastName}
              onChange={(e) => update({ lastName: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              className="input bg-surface-container"
              value={profile.countryOrigin}
              onChange={(e) => update({ countryOrigin: e.target.value })}
            >
              <option value="" disabled>
                Country of origin *
              </option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="input bg-surface-container"
              value={profile.sourceOfFunds}
              onChange={(e) => update({ sourceOfFunds: e.target.value })}
            >
              <option value="" disabled>
                Source of funds *
              </option>
              {SOURCE_OF_FUNDS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-secondary/10 text-secondary hover:bg-secondary/20 border-secondary/40 w-full rounded border py-2 font-mono font-bold disabled:opacity-50"
          >
            {saving ? "SAVING…" : "SAVE SENDER KYC"}
          </button>
        </div>
      )}
    </div>
  );
}
