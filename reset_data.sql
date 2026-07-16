-- REINICIO TOTAL DE DATOS (conserva tablas y políticas)
truncate table
  public.daily_spins,
  public.rewards,
  public.bets,
  public.matches,
  public.tournament_participants,
  public.tournaments,
  public.rankings,
  public.accounts
restart identity cascade;
