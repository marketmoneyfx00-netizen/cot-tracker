//+------------------------------------------------------------------+
//|                     ORB_Expert_Advisor.mq4                       |
//|            Opening Range Breakout - Professional EA v1.0         |
//|       Compatible: MT4, 4/5-digit brokers, ECN, Strategy Tester  |
//+------------------------------------------------------------------+
#property copyright "ORB Expert Advisor - Professional Grade"
#property link      ""
#property version   "1.00"
#property strict

//+------------------------------------------------------------------+
//|  ENUMERATIONS                                                     |
//+------------------------------------------------------------------+

enum ENUM_ENTRY_MODE
{
   BREAKOUT_DIRECT       = 0,  // Mode 1: Direct breakout entry
   BREAKOUT_CONFIRMATION = 1,  // Mode 2: Next candle confirmation
   BREAKOUT_RETEST       = 2   // Mode 3: Wait for retest + rejection
};

enum ENUM_TP_MODE
{
   TP_RR_2  = 1,  // Take Profit 1:2 Risk/Reward
   TP_RR_3  = 2,  // Take Profit 1:3 Risk/Reward
   TP_FIXED = 3   // Take Profit fixed points
};

//+------------------------------------------------------------------+
//|  INPUT PARAMETERS                                                 |
//+------------------------------------------------------------------+

//--- ORB Configuration
input string   s0                      = "=== ORB CONFIGURATION ==="; // ─────────────────────
input int      ORB_Start_Hour          = 15;    // ORB Start Hour (server time)
input int      ORB_Start_Minute        = 30;    // ORB Start Minute
input int      ORB_Duration_Minutes    = 30;    // ORB Duration in minutes

//--- Entry Mode
input string   s1                      = "=== ENTRY MODE ===";        // ─────────────────────
input ENUM_ENTRY_MODE Entry_Mode       = BREAKOUT_DIRECT; // Entry Mode
input int      Retest_Tolerance_Points = 10;    // Retest tolerance (points)
input int      Min_Breakout_Points     = 5;     // Min displacement outside range (points)

//--- Volume Filter
input string   s2                      = "=== VOLUME FILTER ===";     // ─────────────────────
input bool     Volume_Filter           = true;  // Enable volume filter
input int      Volume_Period           = 20;    // Volume average period

//--- Risk Management
input string   s3                      = "=== RISK MANAGEMENT ===";   // ─────────────────────
input bool     Use_Risk_Percent        = true;  // Use risk % (false = fixed lots)
input double   Risk_Percent            = 0.5;   // Risk percent per trade
input double   Fixed_Lots              = 0.01;  // Fixed lot size (if not using %)

//--- Stop Loss
input string   s4                      = "=== STOP LOSS ===";         // ─────────────────────
input bool     Use_ATR_Stop            = false; // Use ATR-based stop loss
input int      ATR_Period              = 14;    // ATR period
input double   ATR_Multiplier          = 1.5;   // ATR multiplier

//--- Take Profit
input string   s5                      = "=== TAKE PROFIT ===";       // ─────────────────────
input ENUM_TP_MODE TP_Mode             = TP_RR_2; // Take profit mode
input int      Fixed_TP_Points         = 100;   // Fixed TP in points (TP_FIXED mode only)

//--- Trade Filters
input string   s6                      = "=== TRADE FILTERS ===";     // ─────────────────────
input bool     One_Trade_Per_Day       = true;  // Limit to one trade per day
input int      Trading_End_Hour        = 20;    // Last hour to open new trades
input int      Minimum_ORB_Size_Points = 10;    // Minimum ORB range (points)
input int      Maximum_ORB_Size_Points = 500;   // Maximum ORB range (points)

//--- Advanced Management
input string   s7                      = "=== ADVANCED MANAGEMENT ==="; // ─────────────────────
input bool     BreakEven_Enable        = true;  // Enable break even
input double   BreakEven_RR            = 1.0;   // Move SL to BE at this R:R
input bool     Trailing_Stop_Enable    = false; // Enable trailing stop
input int      Trailing_Stop_Points    = 30;    // Trailing stop distance (points)
input bool     Partial_Close_Enable    = false; // Enable partial close
input double   Partial_Close_Percent   = 50.0;  // Percent to close partially
input double   Partial_Close_RR        = 1.0;   // Close partial at this R:R

//--- HTF Filter
input string   s8                      = "=== HTF FILTER ===";        // ─────────────────────
input bool     Use_HTF_Filter          = false; // Use higher timeframe filter
input ENUM_TIMEFRAMES HTF_Timeframe    = PERIOD_H1; // Higher timeframe
input int      EMA_Period              = 200;   // EMA period for HTF filter

//--- EA Settings
input string   s9                      = "=== EA SETTINGS ===";       // ─────────────────────
input int      Magic_Number            = 202400; // Magic number
input int      Slippage                = 3;      // Max slippage (points)
input string   EA_Comment              = "ORB_EA"; // Order comment

//+------------------------------------------------------------------+
//|  GLOBAL VARIABLES                                                 |
//+------------------------------------------------------------------+

double   g_orbHigh         = 0;       // ORB high level
double   g_orbLow          = 0;       // ORB low level
bool     g_orbCalculated   = false;   // ORB has been computed for today
bool     g_orbActive       = false;   // ORB window is currently forming
bool     g_tradedToday     = false;   // At least one trade opened today
bool     g_breakoutUp      = false;   // Upward breakout detected
bool     g_breakoutDown    = false;   // Downward breakout detected
bool     g_waitingRetest   = false;   // Waiting for price retest (Mode 3)
bool     g_partialClosed   = false;   // Partial close already executed
datetime g_lastBarTime     = 0;       // Time of last processed bar
datetime g_orbStartTime    = 0;       // ORB window start time
datetime g_orbEndTime      = 0;       // ORB window end time
int      g_currentDay      = -1;      // Current trading day tracker
double   g_pointMult       = 1.0;     // Point multiplier (5-digit = 10.0)
int      g_digits          = 4;       // Symbol digit count
string   g_pfx             = "ORB_";  // Chart object prefix

//+------------------------------------------------------------------+
//|  OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   g_digits  = (int)MarketInfo(Symbol(), MODE_DIGITS);
   // 5-digit and 3-digit (JPY 5-digit) brokers need ×10 correction
   g_pointMult = (g_digits == 3 || g_digits == 5) ? 10.0 : 1.0;

   CleanupObjects();
   Print("ORB EA started | Symbol:", Symbol(),
         " | Digits:", g_digits,
         " | PointMult:", g_pointMult);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//|  OnDeinit                                                         |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   CleanupObjects();
   Comment("");
}

//+------------------------------------------------------------------+
//|  OnTick                                                           |
//+------------------------------------------------------------------+
void OnTick()
{
   // Intra-bar tick: only manage trades and refresh panel
   if(Time[0] == g_lastBarTime)
   {
      ManageOpenTrades();
      DrawPanel();
      return;
   }
   g_lastBarTime = Time[0];

   // Daily state reset
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(g_currentDay != dt.day)
   {
      ResetDailyState();
      g_currentDay = dt.day;
   }

   // Skip weekend sessions
   int dow = DayOfWeek();
   if(dow == 0 || dow == 6) return;

   // Compute ORB levels for today
   CalculateORB();

   // ORB still forming — do not trade
   if(g_orbActive)
   {
      DrawPanel();
      return;
   }

   // ORB not yet available (before window or invalid range)
   if(!g_orbCalculated)
   {
      DrawPanel();
      return;
   }

   // Past trading end hour
   if(dt.hour >= Trading_End_Hour)
   {
      ManageOpenTrades();
      DrawPanel();
      return;
   }

   // One trade per day limit
   if(One_Trade_Per_Day && g_tradedToday)
   {
      ManageOpenTrades();
      DrawPanel();
      return;
   }

   // Skip if EA already has an open position
   if(HasOpenPosition())
   {
      ManageOpenTrades();
      DrawPanel();
      return;
   }

   // Entry logic
   ProcessEntryLogic();
   DrawPanel();
}

//+------------------------------------------------------------------+
//|  ResetDailyState                                                  |
//+------------------------------------------------------------------+
void ResetDailyState()
{
   g_orbHigh       = 0;
   g_orbLow        = 0;
   g_orbCalculated = false;
   g_orbActive     = false;
   g_tradedToday   = false;
   g_breakoutUp    = false;
   g_breakoutDown  = false;
   g_waitingRetest = false;
   g_partialClosed = false;
   CleanupObjects();
   Print("New day: ORB state reset.");
}

//+------------------------------------------------------------------+
//|  CalculateORB                                                     |
//|  Scans historical bars to find the High/Low of the ORB window.   |
//+------------------------------------------------------------------+
void CalculateORB()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);

   // Build absolute timestamps for today's ORB window
   datetime orbStart = StringToTime(StringFormat("%04d.%02d.%02d %02d:%02d",
                         dt.year, dt.mon, dt.day,
                         ORB_Start_Hour, ORB_Start_Minute));
   datetime orbEnd   = orbStart + (datetime)(ORB_Duration_Minutes * 60);

   g_orbStartTime = orbStart;
   g_orbEndTime   = orbEnd;

   // Currently inside the ORB formation window
   if(TimeCurrent() >= orbStart && TimeCurrent() < orbEnd)
   {
      g_orbActive     = true;
      g_orbCalculated = false;
      return;
   }

   // Before the window opens
   if(TimeCurrent() < orbStart)
   {
      g_orbActive     = false;
      g_orbCalculated = false;
      return;
   }

   // Window has closed and ORB not yet computed
   if(!g_orbCalculated)
   {
      g_orbActive = false;
      double hi   = -DBL_MAX;
      double lo   =  DBL_MAX;
      bool   found = false;

      for(int i = Bars - 1; i >= 0; i--)
      {
         if(Time[i] < orbStart) continue;  // bar before window
         if(Time[i] >= orbEnd)  continue;  // bar after window
         if(High[i] > hi) hi = High[i];
         if(Low[i]  < lo) lo = Low[i];
         found = true;
      }

      if(!found || hi <= -DBL_MAX || lo >= DBL_MAX)
      {
         Print("ORB: no bars found in window. Check broker time offset.");
         return;
      }

      double orbSizePts = (hi - lo) / (Point * g_pointMult);

      if(orbSizePts < Minimum_ORB_Size_Points)
      {
         Print("ORB too small (", DoubleToString(orbSizePts, 1), " pts) — skipping today.");
         return;
      }
      if(orbSizePts > Maximum_ORB_Size_Points)
      {
         Print("ORB too large (", DoubleToString(orbSizePts, 1), " pts) — skipping today.");
         return;
      }

      g_orbHigh       = hi;
      g_orbLow        = lo;
      g_orbCalculated = true;
      DrawORBLines();

      Print("ORB ready | High:", DoubleToString(g_orbHigh, g_digits),
            " Low:", DoubleToString(g_orbLow, g_digits),
            " Size:", DoubleToString(orbSizePts, 1), " pts");
   }
}

//+------------------------------------------------------------------+
//|  ProcessEntryLogic — dispatcher                                   |
//+------------------------------------------------------------------+
void ProcessEntryLogic()
{
   if(!g_orbCalculated) return;

   switch(Entry_Mode)
   {
      case BREAKOUT_DIRECT:       ProcessDirectBreakout();       break;
      case BREAKOUT_CONFIRMATION: ProcessConfirmationBreakout(); break;
      case BREAKOUT_RETEST:       ProcessRetestBreakout();       break;
   }
}

//+------------------------------------------------------------------+
//|  Mode 1 — Direct Breakout                                        |
//|  Enter on the same bar that closes beyond ORB + displacement.    |
//+------------------------------------------------------------------+
void ProcessDirectBreakout()
{
   double ptSize   = Point * g_pointMult;
   double minDisp  = Min_Breakout_Points * ptSize;
   double close1   = Close[1]; // last completed bar

   if(close1 > g_orbHigh + minDisp)
   {
      if(CheckVolumeFilter() && CheckHTFFilter(true))
         OpenBuyOrder();
   }
   else if(close1 < g_orbLow - minDisp)
   {
      if(CheckVolumeFilter() && CheckHTFFilter(false))
         OpenSellOrder();
   }
}

//+------------------------------------------------------------------+
//|  Mode 2 — Confirmation Breakout                                  |
//|  Flag the breakout bar; enter at the open of the following bar.  |
//+------------------------------------------------------------------+
void ProcessConfirmationBreakout()
{
   double ptSize  = Point * g_pointMult;
   double minDisp = Min_Breakout_Points * ptSize;
   double close1  = Close[1];

   // Step 1 — detect breakout on last closed bar
   if(!g_breakoutUp && !g_breakoutDown)
   {
      if(close1 > g_orbHigh + minDisp)
      {
         g_breakoutUp = true;
         Print("Conf-mode: BUY breakout flagged. Enter next bar.");
         return;
      }
      if(close1 < g_orbLow - minDisp)
      {
         g_breakoutDown = true;
         Print("Conf-mode: SELL breakout flagged. Enter next bar.");
         return;
      }
      return; // no breakout yet
   }

   // Step 2 — enter at this bar's open (the confirmation bar)
   if(g_breakoutUp)
   {
      if(CheckVolumeFilter() && CheckHTFFilter(true))
         OpenBuyOrder();
      g_breakoutUp = false;
   }
   else if(g_breakoutDown)
   {
      if(CheckVolumeFilter() && CheckHTFFilter(false))
         OpenSellOrder();
      g_breakoutDown = false;
   }
}

//+------------------------------------------------------------------+
//|  Mode 3 — Retest Breakout                                        |
//|  Break → wait for price to retest level → confirm rejection.     |
//+------------------------------------------------------------------+
void ProcessRetestBreakout()
{
   double ptSize   = Point * g_pointMult;
   double minDisp  = Min_Breakout_Points * ptSize;
   double retestTol= Retest_Tolerance_Points * ptSize;
   double close1   = Close[1];
   double high1    = High[1];
   double low1     = Low[1];

   // Phase 1 — detect initial breakout
   if(!g_waitingRetest)
   {
      if(close1 > g_orbHigh + minDisp)
      {
         g_breakoutUp    = true;
         g_breakoutDown  = false;
         g_waitingRetest = true;
         Print("Retest-mode: BUY breakout detected. Waiting retest...");
         return;
      }
      if(close1 < g_orbLow - minDisp)
      {
         g_breakoutDown  = true;
         g_breakoutUp    = false;
         g_waitingRetest = true;
         Print("Retest-mode: SELL breakout detected. Waiting retest...");
         return;
      }
      return;
   }

   // Phase 2 — wait for retest + rejection candle
   if(g_breakoutUp)
   {
      // Bar wick dipped into ORB High zone but closed above it = bullish rejection
      if(low1 <= g_orbHigh + retestTol && close1 > g_orbHigh)
      {
         if(CheckVolumeFilter() && CheckHTFFilter(true))
         {
            Print("Retest-mode: Bullish rejection confirmed. Opening BUY.");
            OpenBuyOrder();
         }
         g_waitingRetest = false;
         g_breakoutUp    = false;
      }
   }
   else if(g_breakoutDown)
   {
      // Bar wick pierced ORB Low zone but closed below it = bearish rejection
      if(high1 >= g_orbLow - retestTol && close1 < g_orbLow)
      {
         if(CheckVolumeFilter() && CheckHTFFilter(false))
         {
            Print("Retest-mode: Bearish rejection confirmed. Opening SELL.");
            OpenSellOrder();
         }
         g_waitingRetest = false;
         g_breakoutDown  = false;
      }
   }
}

//+------------------------------------------------------------------+
//|  CheckVolumeFilter                                                |
//|  Returns true if current bar volume > average or filter is off.  |
//+------------------------------------------------------------------+
bool CheckVolumeFilter()
{
   if(!Volume_Filter) return(true);

   double avgVol = 0;
   for(int i = 1; i <= Volume_Period; i++)
      avgVol += (double)Volume[i];
   avgVol /= (double)Volume_Period;

   if((double)Volume[1] > avgVol) return(true);

   Print("Volume filter blocked | Vol:", Volume[1],
         " Avg:", DoubleToString(avgVol, 1));
   return(false);
}

//+------------------------------------------------------------------+
//|  CheckHTFFilter                                                   |
//|  Returns true when price is on the correct side of the HTF EMA.  |
//+------------------------------------------------------------------+
bool CheckHTFFilter(bool isBuy)
{
   if(!Use_HTF_Filter) return(true);

   double ema = iMA(Symbol(), HTF_Timeframe, EMA_Period, 0, MODE_EMA, PRICE_CLOSE, 0);
   double mid = (Ask + Bid) * 0.5;

   if( isBuy && mid > ema) return(true);
   if(!isBuy && mid < ema) return(true);

   Print("HTF filter blocked | Price:", DoubleToString(mid, g_digits),
         " EMA(", EMA_Period, "):", DoubleToString(ema, g_digits));
   return(false);
}

//+------------------------------------------------------------------+
//|  CalculateStopDistance                                            |
//|  Returns the stop-loss distance in price units.                  |
//+------------------------------------------------------------------+
double CalculateStopDistance(bool isBuy)
{
   if(Use_ATR_Stop)
   {
      double atr = iATR(Symbol(), 0, ATR_Period, 1);
      return(atr * ATR_Multiplier);
   }
   // Default: SL on the opposite ORB boundary
   return(isBuy ? Ask - g_orbLow : g_orbHigh - Bid);
}

//+------------------------------------------------------------------+
//|  CalculateLotSize                                                 |
//|  Converts risk % + stop distance to a valid lot size.            |
//+------------------------------------------------------------------+
double CalculateLotSize(double stopDist)
{
   if(!Use_Risk_Percent)
      return(NormalizeDouble(Fixed_Lots, 2));

   double balance  = AccountBalance();
   double riskAmt  = balance * Risk_Percent / 100.0;
   double tickVal  = MarketInfo(Symbol(), MODE_TICKVALUE);
   double tickSize = MarketInfo(Symbol(), MODE_TICKSIZE);
   double lotStep  = MarketInfo(Symbol(), MODE_LOTSTEP);
   double minLot   = MarketInfo(Symbol(), MODE_MINLOT);
   double maxLot   = MarketInfo(Symbol(), MODE_MAXLOT);

   if(stopDist <= 0 || tickVal <= 0 || tickSize <= 0)
      return(minLot);

   double lots = riskAmt / (stopDist / tickSize * tickVal);
   lots = MathFloor(lots / lotStep) * lotStep;
   lots = MathMax(minLot, MathMin(maxLot, lots));
   return(NormalizeDouble(lots, 2));
}

//+------------------------------------------------------------------+
//|  CalculateTakeProfitDistance                                      |
//+------------------------------------------------------------------+
double CalculateTakeProfitDistance(double stopDist)
{
   switch(TP_Mode)
   {
      case TP_RR_2:  return(stopDist * 2.0);
      case TP_RR_3:  return(stopDist * 3.0);
      case TP_FIXED: return(Fixed_TP_Points * Point * g_pointMult);
   }
   return(stopDist * 2.0);
}

//+------------------------------------------------------------------+
//|  NormalizeSL                                                      |
//|  Enforces broker minimum stop level.                              |
//+------------------------------------------------------------------+
double NormalizeSL(double entry, double rawSL, bool isBuy)
{
   double minStop = MarketInfo(Symbol(), MODE_STOPLEVEL) * Point;
   if(isBuy  && entry - rawSL < minStop) return(NormalizeDouble(entry - minStop, g_digits));
   if(!isBuy && rawSL - entry < minStop) return(NormalizeDouble(entry + minStop, g_digits));
   return(NormalizeDouble(rawSL, g_digits));
}

//+------------------------------------------------------------------+
//|  NormalizeTP                                                      |
//|  Enforces broker minimum stop level for TP.                      |
//+------------------------------------------------------------------+
double NormalizeTP(double entry, double rawTP, bool isBuy)
{
   double minStop = MarketInfo(Symbol(), MODE_STOPLEVEL) * Point;
   if(isBuy  && rawTP - entry < minStop) return(NormalizeDouble(entry + minStop, g_digits));
   if(!isBuy && entry - rawTP < minStop) return(NormalizeDouble(entry - minStop, g_digits));
   return(NormalizeDouble(rawTP, g_digits));
}

//+------------------------------------------------------------------+
//|  OpenBuyOrder                                                     |
//+------------------------------------------------------------------+
void OpenBuyOrder()
{
   if(One_Trade_Per_Day && g_tradedToday) return;

   double stopDist = CalculateStopDistance(true);
   double tpDist   = CalculateTakeProfitDistance(stopDist);
   double lots     = CalculateLotSize(stopDist);

   double entry = Ask;
   double sl    = NormalizeSL(entry, entry - stopDist, true);
   double tp    = NormalizeTP(entry, entry + tpDist,   true);

   int ticket = OrderSend(Symbol(), OP_BUY, lots, entry, Slippage,
                          sl, tp, EA_Comment, Magic_Number, 0, clrGreen);
   if(ticket > 0)
   {
      g_tradedToday = true;
      Print("BUY opened | Ticket:", ticket, " Lots:", DoubleToString(lots, 2),
            " Entry:", DoubleToString(entry, g_digits),
            " SL:", DoubleToString(sl, g_digits),
            " TP:", DoubleToString(tp, g_digits));
   }
   else
      Print("BUY failed | Error:", GetLastError());
}

//+------------------------------------------------------------------+
//|  OpenSellOrder                                                    |
//+------------------------------------------------------------------+
void OpenSellOrder()
{
   if(One_Trade_Per_Day && g_tradedToday) return;

   double stopDist = CalculateStopDistance(false);
   double tpDist   = CalculateTakeProfitDistance(stopDist);
   double lots     = CalculateLotSize(stopDist);

   double entry = Bid;
   double sl    = NormalizeSL(entry, entry + stopDist, false);
   double tp    = NormalizeTP(entry, entry - tpDist,   false);

   int ticket = OrderSend(Symbol(), OP_SELL, lots, entry, Slippage,
                          sl, tp, EA_Comment, Magic_Number, 0, clrRed);
   if(ticket > 0)
   {
      g_tradedToday = true;
      Print("SELL opened | Ticket:", ticket, " Lots:", DoubleToString(lots, 2),
            " Entry:", DoubleToString(entry, g_digits),
            " SL:", DoubleToString(sl, g_digits),
            " TP:", DoubleToString(tp, g_digits));
   }
   else
      Print("SELL failed | Error:", GetLastError());
}

//+------------------------------------------------------------------+
//|  ManageOpenTrades                                                 |
//|  Called on every tick to apply BE, trailing stop, partial close. |
//+------------------------------------------------------------------+
void ManageOpenTrades()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol()      != Symbol())              continue;
      if(OrderMagicNumber() != Magic_Number)          continue;

      int    type      = OrderType();
      int    ticket    = OrderTicket();
      double openPrice = OrderOpenPrice();
      double curSL     = OrderStopLoss();
      double curTP     = OrderTakeProfit();
      double lots      = OrderLots();
      double ptSize    = Point * g_pointMult;

      if(type != OP_BUY && type != OP_SELL) continue;

      double stopDist = (type == OP_BUY) ? openPrice - curSL : curSL - openPrice;
      if(stopDist <= 0) continue;

      if(BreakEven_Enable)
         ApplyBreakEven(ticket, type, openPrice, curSL, curTP, stopDist, ptSize);

      if(Trailing_Stop_Enable)
         ApplyTrailingStop(ticket, type, openPrice, curSL, curTP, ptSize);

      if(Partial_Close_Enable && !g_partialClosed)
         ApplyPartialClose(ticket, type, openPrice, lots, stopDist, ptSize);
   }
}

//+------------------------------------------------------------------+
//|  ApplyBreakEven                                                   |
//+------------------------------------------------------------------+
void ApplyBreakEven(int ticket, int type, double openPrice, double curSL,
                    double curTP, double stopDist, double ptSize)
{
   double newSL = 0;

   if(type == OP_BUY)
   {
      double beLevel = openPrice + stopDist * BreakEven_RR;
      if(Bid >= beLevel && curSL < openPrice + ptSize)
      {
         newSL = NormalizeDouble(openPrice + ptSize, g_digits);
         if(!OrderModify(ticket, openPrice, newSL, curTP, 0, clrYellow))
            Print("BE modify error:", GetLastError());
         else
            Print("BE applied (BUY) ticket:", ticket);
      }
   }
   else // OP_SELL
   {
      double beLevel = openPrice - stopDist * BreakEven_RR;
      if(Ask <= beLevel && curSL > openPrice - ptSize)
      {
         newSL = NormalizeDouble(openPrice - ptSize, g_digits);
         if(!OrderModify(ticket, openPrice, newSL, curTP, 0, clrYellow))
            Print("BE modify error:", GetLastError());
         else
            Print("BE applied (SELL) ticket:", ticket);
      }
   }
}

//+------------------------------------------------------------------+
//|  ApplyTrailingStop                                                |
//+------------------------------------------------------------------+
void ApplyTrailingStop(int ticket, int type, double openPrice, double curSL,
                       double curTP, double ptSize)
{
   double trailDist = Trailing_Stop_Points * ptSize;
   double newSL     = 0;

   if(type == OP_BUY)
   {
      newSL = NormalizeDouble(Bid - trailDist, g_digits);
      if(newSL > curSL + ptSize)
         if(!OrderModify(ticket, openPrice, newSL, curTP, 0, clrDodgerBlue))
            Print("Trail modify error:", GetLastError());
   }
   else // OP_SELL
   {
      newSL = NormalizeDouble(Ask + trailDist, g_digits);
      if(curSL == 0 || newSL < curSL - ptSize)
         if(!OrderModify(ticket, openPrice, newSL, curTP, 0, clrDodgerBlue))
            Print("Trail modify error:", GetLastError());
   }
}

//+------------------------------------------------------------------+
//|  ApplyPartialClose                                                |
//+------------------------------------------------------------------+
void ApplyPartialClose(int ticket, int type, double openPrice, double lots,
                       double stopDist, double ptSize)
{
   bool   trigger    = false;
   double closePrice = 0;

   if(type == OP_BUY)
   {
      double target = openPrice + stopDist * Partial_Close_RR;
      if(Bid >= target) { trigger = true; closePrice = Bid; }
   }
   else
   {
      double target = openPrice - stopDist * Partial_Close_RR;
      if(Ask <= target) { trigger = true; closePrice = Ask; }
   }

   if(!trigger) return;

   double lotStep  = MarketInfo(Symbol(), MODE_LOTSTEP);
   double minLot   = MarketInfo(Symbol(), MODE_MINLOT);
   double closeLots= MathFloor(lots * Partial_Close_Percent / 100.0 / lotStep) * lotStep;
   closeLots       = MathMax(minLot, closeLots);

   if(closeLots >= lots) return; // would close everything — skip

   if(OrderClose(ticket, closeLots, closePrice, Slippage, clrOrange))
   {
      g_partialClosed = true;
      Print("Partial close: ", DoubleToString(closeLots, 2), " lots at ",
            DoubleToString(closePrice, g_digits));
   }
   else
      Print("Partial close error:", GetLastError());
}

//+------------------------------------------------------------------+
//|  HasOpenPosition                                                  |
//+------------------------------------------------------------------+
bool HasOpenPosition()
{
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol()      != Symbol())              continue;
      if(OrderMagicNumber() != Magic_Number)          continue;
      if(OrderType() == OP_BUY || OrderType() == OP_SELL) return(true);
   }
   return(false);
}

//+------------------------------------------------------------------+
//|  DrawORBLines                                                     |
//|  Renders dashed H-Lines + text labels on the chart.              |
//+------------------------------------------------------------------+
void DrawORBLines()
{
   // --- ORB High line ---
   string hiLine = g_pfx + "HighLine";
   ObjectDelete(0, hiLine);
   if(ObjectCreate(0, hiLine, OBJ_HLINE, 0, 0, g_orbHigh))
   {
      ObjectSetInteger(0, hiLine, OBJPROP_COLOR,   clrDodgerBlue);
      ObjectSetInteger(0, hiLine, OBJPROP_STYLE,   STYLE_DASH);
      ObjectSetInteger(0, hiLine, OBJPROP_WIDTH,   2);
      ObjectSetString( 0, hiLine, OBJPROP_TOOLTIP, "ORB High: " + DoubleToString(g_orbHigh, g_digits));
   }

   // --- ORB Low line ---
   string loLine = g_pfx + "LowLine";
   ObjectDelete(0, loLine);
   if(ObjectCreate(0, loLine, OBJ_HLINE, 0, 0, g_orbLow))
   {
      ObjectSetInteger(0, loLine, OBJPROP_COLOR,   clrOrangeRed);
      ObjectSetInteger(0, loLine, OBJPROP_STYLE,   STYLE_DASH);
      ObjectSetInteger(0, loLine, OBJPROP_WIDTH,   2);
      ObjectSetString( 0, loLine, OBJPROP_TOOLTIP, "ORB Low: " + DoubleToString(g_orbLow, g_digits));
   }

   // --- High text label ---
   string hiLbl = g_pfx + "HighLabel";
   ObjectDelete(0, hiLbl);
   if(ObjectCreate(0, hiLbl, OBJ_TEXT, 0, TimeCurrent(), g_orbHigh))
   {
      ObjectSetString( 0, hiLbl, OBJPROP_TEXT,    "  ORB H: " + DoubleToString(g_orbHigh, g_digits));
      ObjectSetInteger(0, hiLbl, OBJPROP_COLOR,    clrDodgerBlue);
      ObjectSetInteger(0, hiLbl, OBJPROP_FONTSIZE, 9);
   }

   // --- Low text label ---
   string loLbl = g_pfx + "LowLabel";
   ObjectDelete(0, loLbl);
   if(ObjectCreate(0, loLbl, OBJ_TEXT, 0, TimeCurrent(), g_orbLow))
   {
      ObjectSetString( 0, loLbl, OBJPROP_TEXT,    "  ORB L: " + DoubleToString(g_orbLow, g_digits));
      ObjectSetInteger(0, loLbl, OBJPROP_COLOR,    clrOrangeRed);
      ObjectSetInteger(0, loLbl, OBJPROP_FONTSIZE, 9);
   }

   ChartRedraw();
}

//+------------------------------------------------------------------+
//|  DrawPanel                                                        |
//|  Displays a live dashboard in the chart comment area.            |
//+------------------------------------------------------------------+
void DrawPanel()
{
   string bias    = "---";
   string htfBias = "---";
   double orbSize = 0;

   if(g_orbCalculated)
   {
      orbSize = (g_orbHigh - g_orbLow) / (Point * g_pointMult);
      double mid = (Ask + Bid) * 0.5;
      if(mid > g_orbHigh)      bias = "BULLISH";
      else if(mid < g_orbLow)  bias = "BEARISH";
      else                     bias = "INSIDE";

      if(Use_HTF_Filter)
      {
         double ema = iMA(Symbol(), HTF_Timeframe, EMA_Period, 0, MODE_EMA, PRICE_CLOSE, 0);
         htfBias = (mid > ema) ? "BULLISH" : "BEARISH";
      }
   }

   string modeStr = "";
   switch(Entry_Mode)
   {
      case BREAKOUT_DIRECT:       modeStr = "DIRECT";       break;
      case BREAKOUT_CONFIRMATION: modeStr = "CONFIRMATION"; break;
      case BREAKOUT_RETEST:       modeStr = "RETEST";       break;
   }

   string orbStatus = g_orbActive ? "FORMING" : (g_orbCalculated ? "READY" : "WAITING");

   Comment(StringFormat(
      "╔══════════════════════════════╗\n"
      "║   ORB Expert Advisor v1.0    ║\n"
      "╠══════════════════════════════╣\n"
      "║ ORB Status : %-15s║\n"
      "║ ORB High   : %-15s║\n"
      "║ ORB Low    : %-15s║\n"
      "║ ORB Range  : %-10.1f pts  ║\n"
      "║ Bias       : %-15s║\n"
      "╠══════════════════════════════╣\n"
      "║ Entry Mode : %-15s║\n"
      "║ HTF Filter : %-3s  Bias:%-8s║\n"
      "║ Vol Filter : %-15s║\n"
      "╠══════════════════════════════╣\n"
      "║ Traded Today: %-14s║\n"
      "║ Risk         : %-13s%%║\n"
      "╚══════════════════════════════╝",
      orbStatus,
      g_orbCalculated ? DoubleToString(g_orbHigh, g_digits) : "---",
      g_orbCalculated ? DoubleToString(g_orbLow,  g_digits) : "---",
      orbSize,
      bias,
      modeStr,
      Use_HTF_Filter ? "ON " : "OFF", htfBias,
      Volume_Filter  ? "ON"  : "OFF",
      g_tradedToday  ? "YES" : "NO",
      DoubleToString(Risk_Percent, 1)
   ));
}

//+------------------------------------------------------------------+
//|  CleanupObjects                                                   |
//+------------------------------------------------------------------+
void CleanupObjects()
{
   string objects[] = {"HighLine", "LowLine", "HighLabel", "LowLabel"};
   for(int i = 0; i < ArraySize(objects); i++)
      ObjectDelete(0, g_pfx + objects[i]);
   ChartRedraw();
}

//+------------------------------------------------------------------+
//  END OF CODE
//
//  ══════════════════════════════════════════════════════════════════
//  INSTALLATION & CONFIGURATION GUIDE
//  ══════════════════════════════════════════════════════════════════
//
//  1. HOW TO INSTALL THE EA
//  ─────────────────────────────────────────────────────────────────
//  a) Copy this file (ORB_Expert_Advisor.mq4) to:
//       <MT4 data folder>\MQL4\Experts\
//     To find the data folder: MT4 menu → File → Open Data Folder
//
//  b) In the MetaEditor (F4 from MT4), open the file and press F7 to
//     compile. Confirm "0 errors, 0 warnings" in the Toolbox tab.
//
//  c) In MT4, open a chart of the desired instrument and timeframe
//     (M5, M15, or M30 recommended for ORB strategies).
//
//  d) Drag the EA from Navigator → Expert Advisors onto the chart.
//     Tick "Allow live trading" and "Allow DLL imports" if prompted.
//
//  e) Confirm the smiley face icon appears in the top-right corner of
//     the chart (EA is running).
//
//  ══════════════════════════════════════════════════════════════════
//  2. ORB CONFIGURATION — LONDON SESSION
//  ──────────────────────────────────────
//  The London session opens at 08:00 UK time (UTC+1 BST / UTC+0 GMT).
//  Most brokers use UTC+2 (winter) or UTC+3 (summer) server time.
//
//  Typical London ORB (first 30 minutes):
//    ORB_Start_Hour   = 9   (broker UTC+2, winter)
//    ORB_Start_Minute = 0
//    ORB_Duration_Minutes = 30
//
//  Summer (BST, broker UTC+3):
//    ORB_Start_Hour   = 10
//    ORB_Start_Minute = 0
//    ORB_Duration_Minutes = 30
//
//  TIP: Check your broker's server time in MT4's bottom status bar.
//  Subtract server time from 08:00 London time to get the offset.
//
//  ══════════════════════════════════════════════════════════════════
//  3. ORB CONFIGURATION — NEW YORK SESSION
//  ────────────────────────────────────────
//  New York opens at 13:30 UTC (09:30 ET), which is the stock market
//  open — the most volatile ORB window for US indices and DXY pairs.
//
//  Broker UTC+2 (winter):
//    ORB_Start_Hour   = 15
//    ORB_Start_Minute = 30
//    ORB_Duration_Minutes = 30
//
//  Broker UTC+3 (summer, ET = UTC-4):
//    ORB_Start_Hour   = 16
//    ORB_Start_Minute = 30
//    ORB_Duration_Minutes = 30
//
//  For forex pairs that react to US macro data (NFP, CPI) use a
//  shorter ORB of 15 minutes to capture the initial impulse.
//
//  ══════════════════════════════════════════════════════════════════
//  4. RECOMMENDED PARAMETERS BY INSTRUMENT
//  ──────────────────────────────────────────────────────────────────
//
//  ┌─────────────────────────────────────────────────────────────┐
//  │  NASDAQ (US100 / NAS100)                                    │
//  ├─────────────────────────────────────────────────────────────┤
//  │  Timeframe            : M5 or M15                           │
//  │  ORB_Start_Hour       : 16 (broker UTC+3, summer)           │
//  │  ORB_Start_Minute     : 30                                  │
//  │  ORB_Duration_Minutes : 15 (first 15 min of NYSE open)      │
//  │  Entry_Mode           : BREAKOUT_CONFIRMATION               │
//  │  Min_Breakout_Points  : 10  (points, not pips)              │
//  │  Minimum_ORB_Size     : 50 points                           │
//  │  Maximum_ORB_Size     : 800 points                          │
//  │  Use_ATR_Stop         : true                                │
//  │  ATR_Period           : 14, ATR_Multiplier : 1.5            │
//  │  TP_Mode              : TP_RR_2                             │
//  │  Risk_Percent         : 0.5                                 │
//  │  Use_HTF_Filter       : true, HTF = H1                      │
//  │  Volume_Filter        : true, Volume_Period = 20            │
//  │  BreakEven_Enable     : true, BreakEven_RR = 1.0            │
//  │  Trading_End_Hour     : 22                                  │
//  └─────────────────────────────────────────────────────────────┘
//
//  ┌─────────────────────────────────────────────────────────────┐
//  │  GOLD (XAUUSD)                                              │
//  ├─────────────────────────────────────────────────────────────┤
//  │  Timeframe            : M15                                 │
//  │  ORB_Start_Hour       : 9  (London open, broker UTC+2)      │
//  │  ORB_Start_Minute     : 0                                   │
//  │  ORB_Duration_Minutes : 30                                  │
//  │  Entry_Mode           : BREAKOUT_RETEST (for quality)       │
//  │  Min_Breakout_Points  : 20  (Gold ticks in $0.01 units)     │
//  │  Retest_Tolerance     : 15 points                           │
//  │  Minimum_ORB_Size     : 100 points                          │
//  │  Maximum_ORB_Size     : 1500 points                         │
//  │  Use_ATR_Stop         : true                                │
//  │  ATR_Period           : 14, ATR_Multiplier : 2.0            │
//  │  TP_Mode              : TP_RR_3 (Gold trends strongly)      │
//  │  Risk_Percent         : 0.5                                 │
//  │  Partial_Close_Enable : true, Partial_Close_Percent = 50    │
//  │  Partial_Close_RR     : 1.5                                 │
//  │  Trailing_Stop_Enable : true, Trailing_Stop_Points = 150    │
//  │  Use_HTF_Filter       : true, HTF = H4                      │
//  │  Trading_End_Hour     : 21                                  │
//  └─────────────────────────────────────────────────────────────┘
//
//  ┌─────────────────────────────────────────────────────────────┐
//  │  EURUSD                                                     │
//  ├─────────────────────────────────────────────────────────────┤
//  │  Timeframe            : M15 or M30                          │
//  │  ORB_Start_Hour       : 9  (London open, broker UTC+2)      │
//  │  ORB_Start_Minute     : 0                                   │
//  │  ORB_Duration_Minutes : 30                                  │
//  │  Entry_Mode           : BREAKOUT_CONFIRMATION               │
//  │  Min_Breakout_Points  : 5 pips (= 50 pts on 5-digit broker) │
//  │  Minimum_ORB_Size     : 10 pips (= 100 pts)                 │
//  │  Maximum_ORB_Size     : 60 pips (= 600 pts)                 │
//  │  Use_ATR_Stop         : false (use ORB boundary SL)         │
//  │  TP_Mode              : TP_RR_2                             │
//  │  Risk_Percent         : 0.5                                 │
//  │  Volume_Filter        : true, Volume_Period = 20            │
//  │  BreakEven_Enable     : true, BreakEven_RR = 1.0            │
//  │  Use_HTF_Filter       : true, HTF = H1, EMA_Period = 200    │
//  │  Trading_End_Hour     : 18                                  │
//  └─────────────────────────────────────────────────────────────┘
//
//  ══════════════════════════════════════════════════════════════════
//  NOTE ON MINIMUM BREAKOUT DISPLACEMENT (Min_Breakout_Points)
//  ──────────────────────────────────────────────────────────────────
//  This parameter requires the breakout candle to close at least
//  X points BEYOND the ORB boundary before a trade is triggered.
//  It prevents entering on candles that barely graze the level
//  (false breakouts / wicks through the level).
//
//  On a 5-digit broker: 5 pips = 50 points → set 50
//  On a 4-digit broker: 5 pips = 5 points  → set 5
//
//  The EA automatically corrects for broker digit count via the
//  g_pointMult multiplier, so you can use natural pip-like values
//  on 5-digit brokers (the code multiplies Point × g_pointMult).
//+------------------------------------------------------------------+
