-- =============================================================================
-- Job Cockpit — socle multi-comptes
-- =============================================================================
-- Portage du schéma SQLite local vers Postgres, avec UNE différence de fond :
-- chaque ligne appartient à un compte, et personne ne peut lire les lignes
-- d'un autre.
--
-- POURQUOI RLS (Row Level Security) PLUTÔT QU'UN FILTRE DANS LE CODE
-- -------------------------------------------------------------------
-- Filtrer par `user_id` dans les requêtes marche… jusqu'au jour où un WHERE
-- est oublié dans une route. La faille est alors invisible : tout fonctionne,
-- mais chacun voit les candidatures des autres.
--
-- Avec RLS, l'isolation est appliquée par Postgres lui-même, sous chaque
-- requête. Une requête qui oublie son filtre ne renvoie rien — au lieu de
-- tout renvoyer. La faute devient visible immédiatement, et sans gravité.
--
-- CONVENTION : toutes les tables portent `user_id uuid NOT NULL` référençant
-- auth.users, avec suppression en cascade. Supprimer un compte efface donc
-- réellement toutes ses données — c'est ce que le RGPD exige, et ça évite
-- d'avoir à y penser.
-- =============================================================================

-- ─────────────────────────────── PROFILS ───────────────────────────────
-- Le pendant de `profile/profile.json` : critères de recherche, villes,
-- règles de scoring. Un profil par compte.

create table public.profils (
  id          uuid primary key references auth.users(id) on delete cascade,
  nom         text,
  ville       text,
  email       text,
  telephone   text,
  -- Le profil de recherche reste du JSON : sa forme évolue à chaque réglage
  -- de scoring, et la figer en colonnes imposerait une migration à chaque fois.
  criteres    jsonb not null default '{}'::jsonb,
  cree_le     timestamptz not null default now(),
  modifie_le  timestamptz not null default now()
);

comment on column public.profils.criteres is
  'villesPrioritaires, intitules, rayonKm, fraicheurJours, scoring, flux — ' ||
  'le contenu de profile.json, moins les données d''identité.';

-- ─────────────────────────────── OFFRES ────────────────────────────────
-- L'identifiant d'offre est calculé par hachage du contenu : deux comptes
-- peuvent donc collecter LA MÊME offre. La clé primaire est le couple
-- (user_id, id) — sans quoi le second collecteur écraserait le premier.

create table public.offres (
  user_id        uuid not null references auth.users(id) on delete cascade,
  id             text not null,
  source         text,
  sources_all    jsonb default '[]'::jsonb,
  external_id    text,
  titre          text not null,
  entreprise     text,
  ville          text,
  departement    text,
  hors_zone      boolean not null default false,
  contrat        text,
  date_offre     date,
  lien           text,
  description    text,
  salaire_source text,
  groupe         smallint,
  score          integer,
  score_detail   jsonb,
  analyse        jsonb,
  analyse_le     timestamptz,
  ajout_manuel   boolean not null default false,
  vue_le         timestamptz not null default now(),
  revue_le       timestamptz not null default now(),
  primary key (user_id, id)
);

create index on public.offres (user_id, groupe);
create index on public.offres (user_id, date_offre desc);
create index on public.offres (user_id, revue_le);

-- ──────────────────────── SUIVI DE CANDIDATURE ─────────────────────────
-- LA table à ne jamais écraser par une collecte : statuts, notes, relances,
-- épingles. C'est la garantie centrale du projet depuis le premier jour.
-- La contrainte de clé étrangère vers `offres` la fait disparaître avec son
-- offre, mais jamais autrement.

create table public.suivi (
  user_id      uuid not null references auth.users(id) on delete cascade,
  offre_id     text not null,
  statut       text not null default 'À postuler',
  envoi_le     date,
  relance_le   date,
  notes        text,
  epinglee     boolean not null default false,
  modifie_le   timestamptz not null default now(),
  primary key (user_id, offre_id),
  foreign key (user_id, offre_id) references public.offres(user_id, id) on delete cascade
);

create index on public.suivi (user_id, relance_le) where relance_le is not null;

-- ───────────────────────────── LETTRES ─────────────────────────────────

create table public.lettres (
  user_id     uuid not null references auth.users(id) on delete cascade,
  offre_id    text not null,
  contenu     text not null,
  generee_le  timestamptz not null default now(),
  retouchee   boolean not null default false,
  primary key (user_id, offre_id),
  foreign key (user_id, offre_id) references public.offres(user_id, id) on delete cascade
);

-- ─────────────────────── JOURNAL D'ACTIVITÉ ────────────────────────────
-- Alimente les courbes, le calendrier d'assiduité et le journal.

create table public.evenements (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  type      text not null,          -- candidature, relance, lettre, note, ajout…
  offre_id  text,
  jour      date not null,          -- en heure LOCALE du candidat, jamais UTC
  heure     smallint check (heure between 0 and 23),
  cree_le   timestamptz not null default now(),
  meta      jsonb
);

create index on public.evenements (user_id, jour desc);
create index on public.evenements (user_id, type);

-- ───────────────────────────── RÉGLAGES ────────────────────────────────
-- Le pendant de la table `meta` : objectif hebdomadaire, date de dernière
-- collecte, statut de la dernière collecte.

create table public.reglages (
  user_id uuid not null references auth.users(id) on delete cascade,
  cle     text not null,
  valeur  jsonb,
  primary key (user_id, cle)
);

-- =============================================================================
-- CLOISONNEMENT — Row Level Security
-- =============================================================================
-- Sans `enable row level security`, les politiques ci-dessous ne servent à
-- RIEN : Postgres les ignore. C'est l'oubli classique, et il est silencieux.

alter table public.profils     enable row level security;
alter table public.offres      enable row level security;
alter table public.suivi       enable row level security;
alter table public.lettres     enable row level security;
alter table public.evenements  enable row level security;
alter table public.reglages    enable row level security;

-- Une seule règle, appliquée partout : on ne voit que ses propres lignes, et
-- on ne peut en écrire qu'à son propre nom. `with check` est indispensable —
-- sans lui, on pourrait INSÉRER une ligne au nom de quelqu'un d'autre.

create policy "chacun ne voit que ses données" on public.profils
  for all using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "chacun ne voit que ses données" on public.offres
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "chacun ne voit que ses données" on public.suivi
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "chacun ne voit que ses données" on public.lettres
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "chacun ne voit que ses données" on public.evenements
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "chacun ne voit que ses données" on public.reglages
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- =============================================================================
-- CRÉATION AUTOMATIQUE DU PROFIL
-- =============================================================================
-- À l'inscription, Supabase crée une ligne dans auth.users — mais rien dans
-- `profils`. Sans ce déclencheur, le premier écran de l'application planterait
-- sur un profil absent.

create function public.creer_profil_a_inscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profils (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger creer_profil_apres_inscription
  after insert on auth.users
  for each row execute function public.creer_profil_a_inscription();

-- =============================================================================
-- CV — stockage des fichiers
-- =============================================================================
-- Le CV est un fichier, pas une ligne de table : il va dans Supabase Storage.
-- Le seau est PRIVÉ, et chacun ne peut déposer, lire et supprimer que dans le
-- dossier qui porte son identifiant.

insert into storage.buckets (id, name, public)
values ('cv', 'cv', false)
on conflict (id) do nothing;

create policy "chacun ne touche qu'à son propre CV" on storage.objects
  for all
  using (bucket_id = 'cv' and (select auth.uid())::text = (storage.foldername(name))[1])
  with check (bucket_id = 'cv' and (select auth.uid())::text = (storage.foldername(name))[1]);
