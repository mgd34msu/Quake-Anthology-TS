// Source report semantics from id Software game/g_rankings.c and g_rankings.h.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { Weapon, Powerup, Holdable } from "../shared/definitions.ts";
export type Q3RankingReport =
  | { readonly kind: "integer"; readonly self: number; readonly other: number; readonly key: number; readonly value: number; readonly accumulate: boolean }
  | { readonly kind: "string"; readonly self: number; readonly other: number; readonly key: number; readonly value: string };
export class Q3RankingReports {
  private sink: ((report: Q3RankingReport) => void) | null = null;
  private warmup: () => boolean = () => true;
  attach(sink: (report: Q3RankingReport) => void, warmup: () => boolean): () => void {
    if (this.sink !== null) throw new Error("Ranking report owner already attached");
    this.sink = sink; this.warmup = warmup;
    return () => { this.sink = null; this.warmup = () => true; };
  }
  integer(self: number, other: number, key: number, value: number, accumulate: boolean): void {
    if (!this.warmup()) this.sink?.({ kind: "integer", self, other, key, value, accumulate });
  }
  string(self: number, other: number, key: number, value: string): void {
    if (!this.warmup()) this.sink?.({ kind: "string", self, other, key, value });
  }
  fireWeapon(self: number, weapon: number): void {
  if (this.warmup()) return;
  
  if( weapon == Weapon.WP_GAUNTLET )
  {
    
    return;
  }
  
  this.integer( self, -1, 1111020002, 1, true);
  
  switch( weapon )
  {
  case Weapon.WP_MACHINEGUN:
    this.integer( self, -1, 1111020202, 1, true);
    break;
  case Weapon.WP_SHOTGUN:
    this.integer( self, -1, 1111020302, 1, true);
    break;
  case Weapon.WP_GRENADE_LAUNCHER:
    this.integer( self, -1, 1111020402, 1, true);
    break;
  case Weapon.WP_ROCKET_LAUNCHER:
    this.integer( self, -1, 1111020502, 1, true);
    break;
  case Weapon.WP_LIGHTNING:
    this.integer( self, -1, 1111020802, 1, true);
    break;
  case Weapon.WP_RAILGUN:
    this.integer( self, -1, 1111020702, 1, true);
    break;
  case Weapon.WP_PLASMAGUN:
    this.integer( self, -1, 1111020602, 1, true);
    break;
  case Weapon.WP_BFG:
    this.integer( self, -1, 1111020902, 1, true);
    break;
  case Weapon.WP_GRAPPLING_HOOK:
    this.integer( self, -1, 1111021002, 1, true);
    break;
  default:
    break;
  }
  }
  pickupWeapon(self: number, weapon: number): void {
  if (this.warmup()) return;
  
  this.integer( self, -1, 1111020009, 1, true);
  switch( weapon )
  {
  case Weapon.WP_GAUNTLET:
    this.integer( self, -1, 1111020109, 1, true);
    break;
  case Weapon.WP_MACHINEGUN:
    this.integer( self, -1, 1111020209, 1, true);
    break;
  case Weapon.WP_SHOTGUN:
    this.integer( self, -1, 1111020309, 1, true);
    break;
  case Weapon.WP_GRENADE_LAUNCHER:
    this.integer( self, -1, 1111020409, 1, true);
    break;
  case Weapon.WP_ROCKET_LAUNCHER:
    this.integer( self, -1, 1111020509, 1, true);
    break;
  case Weapon.WP_LIGHTNING:
    this.integer( self, -1, 1111020809, 1, true);
    break;
  case Weapon.WP_RAILGUN:
    this.integer( self, -1, 1111020709, 1, true);
    break;
  case Weapon.WP_PLASMAGUN:
    this.integer( self, -1, 1111020609, 1, true);
    break;
  case Weapon.WP_BFG:
    this.integer( self, -1, 1111020909, 1, true);
    break;
  case Weapon.WP_GRAPPLING_HOOK:
    this.integer( self, -1, 1111021009, 1, true);
    break;
  default:
    break;
  }
  }
  pickupAmmo(self: number, weapon: number, quantity: number): void {
  if (this.warmup()) return;
  
  this.integer( self, -1, 1111030000, 1, true);
  this.integer( self, -1, 1111030001, quantity, true);
  
  switch( weapon )
  {
  case Weapon.WP_MACHINEGUN:
    this.integer( self, -1, 1111030100, 1, true);
    this.integer( self, -1, 1111030101, quantity, true);
    break;
  case Weapon.WP_SHOTGUN:
    this.integer( self, -1, 1111030200, 1, true);
    this.integer( self, -1, 1111030201, quantity, true);
    break;
  case Weapon.WP_GRENADE_LAUNCHER:
    this.integer( self, -1, 1111030300, 1, true);
    this.integer( self, -1, 1111030301, quantity, true);
    break;
  case Weapon.WP_ROCKET_LAUNCHER:
    this.integer( self, -1, 1111030400, 1, true);
    this.integer( self, -1, 1111030401, quantity, true);
    break;
  case Weapon.WP_LIGHTNING:
    this.integer( self, -1, 1111030700, 1, true);
    this.integer( self, -1, 1111030701, quantity, true);
    break;
  case Weapon.WP_RAILGUN:
    this.integer( self, -1, 1111030600, 1, true);
    this.integer( self, -1, 1111030601, quantity, true);
    break;
  case Weapon.WP_PLASMAGUN:
    this.integer( self, -1, 1111030500, 1, true);
    this.integer( self, -1, 1111030501, quantity, true);
    break;
  case Weapon.WP_BFG:
    this.integer( self, -1, 1111030800, 1, true);
    this.integer( self, -1, 1111030801, quantity, true);
    break;
  default:
    break;
  }
  }
  pickupHealth(self: number, quantity: number): void {
  if (this.warmup()) return;
  
  this.integer( self, -1, 1111040000, 1, true);
  this.integer( self, -1, 1111040001, quantity, true);

  switch( quantity )
  {
  case 5:
    this.integer( self, -1, 1111040100, 1, true);
    break;
  case 25:
    this.integer( self, -1, 1111040200, 1, true);
    break;
  case 50:
    this.integer( self, -1, 1111040300, 1, true);
    break;
  case 100:
    this.integer( self, -1, 1111040400, 1, true);
    break;
  default:
    break;
  }
  }
  pickupArmor(self: number, quantity: number): void {
  if (this.warmup()) return;
  
  this.integer( self, -1, 1111050000, 1, true);
  this.integer( self, -1, 1111050001, quantity, true);

  switch( quantity )
  {
  case 5:
    this.integer( self, -1, 1111050100, 1, true);
    break;
  case 50:
    this.integer( self, -1, 1111050200, 1, true);
    break;
  case 100:
    this.integer( self, -1, 1111050300, 1, true);
    break;
  default:
    break;
  }
  }
  pickupPowerup(self: number, powerup: number): void {
  if (this.warmup()) return;
  
  
  if( (powerup == Powerup.PW_REDFLAG) || (powerup == Powerup.PW_BLUEFLAG) )
  {
    this.integer( self, -1, 1111110000, 1, true);
    return;
  }

  this.integer( self, -1, 1111060000, 1, true);
  
  switch( powerup )
  {
  case Powerup.PW_QUAD:
    this.integer( self, -1, 1111060100, 1, true);
    break;
  case Powerup.PW_BATTLESUIT:
    this.integer( self, -1, 1111060200, 1, true);
    break;
  case Powerup.PW_HASTE:
    this.integer( self, -1, 1111060300, 1, true);
    break;
  case Powerup.PW_INVIS:
    this.integer( self, -1, 1111060400, 1, true);
    break;
  case Powerup.PW_REGEN:
    this.integer( self, -1, 1111060500, 1, true);
    break;
  case Powerup.PW_FLIGHT:
    this.integer( self, -1, 1111060600, 1, true);
    break;
  default:
    break;
  }
  }
  pickupHoldable(self: number, holdable: number): void {
  if (this.warmup()) return;
  
  switch( holdable )
  {
  case Holdable.HI_MEDKIT:
    this.integer( self, -1, 1111070000, 1, true);
    break;
  case Holdable.HI_TELEPORTER:
    this.integer( self, -1, 1111070100, 1, true);
    break;
  default:
    break;
  }
  }
  useHoldable(self: number, holdable: number): void {
  if (this.warmup()) return;
  
  switch( holdable )
  {
  case Holdable.HI_MEDKIT:
    this.integer( self, -1, 1111070001, 1, true);
    break;
  case Holdable.HI_TELEPORTER:
    this.integer( self, -1, 1111070101, 1, true);
    break;
  default:
    break;
  }
  }
  reward(self: number, award: number): void {
  if (this.warmup()) return;
  
  switch( award )
  {
  case 0x8000:
    this.integer( self, -1, 1111090000, 1, true);
    break;
  case 0x8:
    this.integer( self, -1, 1111090100, 1, true);
    break;
  default:
    break;
  }
  }
  capture(self: number): void {
  if (this.warmup()) return;
  
  this.integer( self, -1, 1111110001, 1, true);
  }
  private lastHit = "";
  damage(self: number, attacker: number, damage: number, means_of_death: number, frame: number, attackerIsClient: boolean, sameTeam: boolean): void {
  
  
  
  
  

  
  let splash = 0;
  let key_hit = 0;
  let key_damage = 0;
  let key_splash = 0;

  if (this.warmup()) return;
  
  const hit = `${frame}:${self}:${attacker}:${means_of_death}`;
    const new_hit = hit !== this.lastHit; this.lastHit = hit;

  
  if( (attacker != 1022) && (attacker != self) && 
    (means_of_death == 2)  && 
    (attackerIsClient) )
  {
    this.integer( attacker, -1, 1111020102, 1, true);
  }

  
  switch( means_of_death )
  {
  case 14:
  case 15:
  case 16:
  case 17:
  case 18:
  case 19:
  case 20:
  case 22:
    return;
  default:
    break;
  }

  
  switch( means_of_death )
  {
  case 5:
  case 7:
  case 9:
  case 13:
    splash = damage;
    break;
  default:
    splash = 0;
    key_splash = -1;
    break;
  }
  
  
  switch( means_of_death )
  {
  case 2:
    key_hit = 1111020104;
    key_damage = 1111020106;
    break;
  case 3:
    key_hit = 1111020204;
    key_damage = 1111020206;
    break;
  case 1:
    key_hit = 1111020304;
    key_damage = 1111020306;
    break;
  case 4:
  case 5:
    key_hit = 1111020404;
    key_damage = 1111020406;
    key_splash = 1111020408;
    break;
  case 6:
  case 7:
    key_hit = 1111020504;
    key_damage = 1111020506;
    key_splash = 1111020508;
    break;
  case 8:
  case 9:
    key_hit = 1111020604;
    key_damage = 1111020606;
    key_splash = 1111020608;
    break;
  case 10:
    key_hit = 1111020704;
    key_damage = 1111020706;
    break;
  case 11:
    key_hit = 1111020804;
    key_damage = 1111020806;
    break;
  case 12:
  case 13:
    key_hit = 1111020904;
    key_damage = 1111020906;
    key_splash = 1111020908;
    break;
  case 23:
    key_hit = 1111021004;
    key_damage = 1111021006;
    break;
  default:
    key_hit = 1111021104;
    key_damage = 1111021106;
    break;
  }

  
  if( new_hit )
  {
    this.integer( self, -1, 1111020004, 1, true);
    this.integer( self, -1, key_hit, 1, true);
  }
  
  
  this.integer( self, -1, 1111020006, damage, true);
  this.integer( self, -1, key_damage, damage, true);

  
  if( splash != 0 )
  {
    this.integer( self, -1, 1111020008, splash, true);
    this.integer( self, -1, key_splash, splash, true);
  }

  
  if( (attacker != 1022) && (attacker != self) )
  {
    switch( means_of_death )
    {
    case 2:
      key_hit = 1111020103;
      key_damage = 1111020105;
      break;
    case 3:
      key_hit = 1111020203;
      key_damage = 1111020205;
      break;
    case 1:
      key_hit = 1111020303;
      key_damage = 1111020305;
      break;
    case 4:
    case 5:
      key_hit = 1111020403;
      key_damage = 1111020405;
      key_splash = 1111020407;
      break;
    case 6:
    case 7:
      key_hit = 1111020503;
      key_damage = 1111020505;
      key_splash = 1111020507;
      break;
    case 8:
    case 9:
      key_hit = 1111020603;
      key_damage = 1111020605;
      key_splash = 1111020607;
      break;
    case 10:
      key_hit = 1111020703;
      key_damage = 1111020705;
      break;
    case 11:
      key_hit = 1111020803;
      key_damage = 1111020805;
      break;
    case 12:
    case 13:
      key_hit = 1111020903;
      key_damage = 1111020905;
      key_splash = 1111020907;
      break;
    case 23:
      key_hit = 1111021003;
      key_damage = 1111021005;
      break;
    default:
      key_hit = 1111021103;
      key_damage = 1111021105;
      break;
    }
    
    
    
    
    
    if (attackerIsClient) {
      if( new_hit )
      {
        this.integer( attacker, -1, 1111020003, 1, true);
        this.integer( attacker, -1, key_hit, 1, true);
      }
      
      
      this.integer( attacker, -1, 1111020005, damage, true);
      this.integer( attacker, -1, key_damage, damage, true);

      
      if( splash != 0 )
      {
        this.integer( attacker, -1, 1111020007, splash, true);
        this.integer( attacker, -1, key_splash, splash, true);
      }
    }
  }

  
  if( (attacker != self) && 
    sameTeam &&
    (attackerIsClient) )
  {
    
    if( new_hit )
    {
      this.integer( self, -1, 1111100002, 1, true);
      this.integer( attacker, -1, 1111100001, 1, true);
    }

    
    this.integer( self, -1, 1111100004, damage, true);
    this.integer( attacker, -1, 1111100003, 
      damage, true);
      
    
    if( splash != 0 )
    {
      this.integer( self, -1, 1111100006, 
        splash, true);
      this.integer( attacker, -1, 1111100005, 
        splash, true);
    }
  }
  }
  playerDie(self: number, attacker: number, means_of_death: number): void {
  let p1 = 0;
  let p2 = 0;

  if (this.warmup()) return;
  
  if( attacker == 1022 )
  {
    p1 = self;
    p2 = -1;
    
    this.integer( p1, p2, 1111080000, 1, true);

    switch( means_of_death )
    {
    case 14:
      this.integer( p1, p2, 1111080100, 1, true);
      break;
    case 15:
      this.integer( p1, p2, 1111080200, 1, true);
      break;
    case 16:
      this.integer( p1, p2, 1111080300, 1, true);
      break;
    case 17:
      this.integer( p1, p2, 1111080400, 1, true);
      break;
    case 18:
      this.integer( p1, p2, 1111080500, 1, true);
      break;
    case 19:
      this.integer( p1, p2, 1111080600, 1, true);
      break;
    case 20:
      this.integer( p1, p2, 1111080700, 1, true);
      break;
    case 22:
      this.integer( p1, p2, 1111080800, 1, true);
      break;
    default:
      this.integer( p1, p2, 1111080900, 1, true);
      break;
    }
  }
  else if( attacker == self )
  {
    p1 = self;
    p2 = -1;
    
    this.integer( p1, p2, 1111020001, 1, true);
    
    switch( means_of_death )
    {
    case 2:
      this.integer( p1, p2, 1111020101, 1, true);
      break;
    case 3:
      this.integer( p1, p2, 1111020201, 1, true);
      break;
    case 1:
      this.integer( p1, p2, 1111020301, 1, true);
      break;
    case 4:
    case 5:
      this.integer( p1, p2, 1111020401, 1, true);
      break;
    case 6:
    case 7:
      this.integer( p1, p2, 1111020501, 1, true);
      break;
    case 8:
    case 9:
      this.integer( p1, p2, 1111020601, 1, true);
      break;
    case 10:
      this.integer( p1, p2, 1111020701, 1, true);
      break;
    case 11:
      this.integer( p1, p2, 1111020801, 1, true);
      break;
    case 12:
    case 13:
      this.integer( p1, p2, 1111020901, 1, true);
      break;
    case 23:
      this.integer( p1, p2, 1111021001, 1, true);
      break;
    default:
      this.integer( p1, p2, 1111021101, 1, true);
      break;
    }
  }
  else
  {
    p1 = attacker;
    p2 = self;

    this.integer( p1, p2, 1211020000, 1, true);
    
    switch( means_of_death )
    {
    case 2:
      this.integer( p1, p2, 1211020100, 1, true);
      break;
    case 3:
      this.integer( p1, p2, 1211020200, 1, true);
      break;
    case 1:
      this.integer( p1, p2, 1211020300, 1, true);
      break;
    case 4:
    case 5:
      this.integer( p1, p2, 1211020400, 1, true);
      break;
    case 6:
    case 7:
      this.integer( p1, p2, 1211020500, 1, true);
      break;
    case 8:
    case 9:
      this.integer( p1, p2, 1211020600, 1, true);
      break;
    case 10:
      this.integer( p1, p2, 1211020700, 1, true);
      break;
    case 11:
      this.integer( p1, p2, 1211020800, 1, true);
      break;
    case 12:
    case 13:
      this.integer( p1, p2, 1211020900, 1, true);
      break;
    case 23:
      this.integer( p1, p2, 1211021000, 1, true);
      break;
    default:
      this.integer( p1, p2, 1211021100, 1, true);
      break;
    }
  }
  }
  weaponTime(self: number, weapon: number, time: number): void {
    if (time <= 0 || this.warmup()) return;
    this.integer(self, -1, 1111020010, time, true);
  switch( weapon )
  {
  case Weapon.WP_GAUNTLET:
    this.integer( self, -1, 1111020110, time, true);
    break;
  case Weapon.WP_MACHINEGUN:
    this.integer( self, -1, 1111020210, time, true);
    break;
  case Weapon.WP_SHOTGUN:
    this.integer( self, -1, 1111020310, time, true);
    break;
  case Weapon.WP_GRENADE_LAUNCHER:
    this.integer( self, -1, 1111020410, time, true);
    break;
  case Weapon.WP_ROCKET_LAUNCHER:
    this.integer( self, -1, 1111020510, time, true);
    break;
  case Weapon.WP_LIGHTNING:
    this.integer( self, -1, 1111020810, time, true);
    break;
  case Weapon.WP_RAILGUN:
    this.integer( self, -1, 1111020710, time, true);
    break;
  case Weapon.WP_PLASMAGUN:
    this.integer( self, -1, 1111020610, time, true);
    break;
  case Weapon.WP_BFG:
    this.integer( self, -1, 1111020910, time, true);
    break;
  case Weapon.WP_GRAPPLING_HOOK:
    this.integer( self, -1, 1111021010, time, true);
    break;
  default:
    break;
  }
  }
  teamName(self: number, name: string): void { this.string(self, -1, 1100100007, name); }
}
