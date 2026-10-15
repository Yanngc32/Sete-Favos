package com.yanngc32.central

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import kotlin.concurrent.thread

/**
 * Widget com até [MAX] itens (aparelhos, teclas do interruptor ou rotinas). Cada item é um botão:
 * toque liga/desliga só aquele item (ou roda a rotina). Baixo = uma linha; alto com 3+ itens = grade 2x2.
 */
class DeviceWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) = refresh(ctx, ids)

    override fun onAppWidgetOptionsChanged(ctx: Context, manager: AppWidgetManager, id: Int, options: Bundle) =
        refresh(ctx, intArrayOf(id))

    override fun onDeleted(ctx: Context, ids: IntArray) = ids.forEach { WidgetPrefs.clear(ctx, it) }

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        if (intent.action != ACTION_TAP) return
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
        val slot = intent.getIntExtra(EXTRA_SLOT, -1)
        val items = WidgetPrefs.load(ctx, id)
        val target = items.getOrNull(slot) ?: return
        val pending = goAsync()
        thread {
            try {
                val shown = last[id]?.takeIf { it.size == items.size } ?: items.map { Slot.unknown(ctx, it) }
                render(ctx, id, items, shown.replace(slot, Slot(null, ctx.getString(if (target.routine) R.string.rodando else R.string.aguarde))))
                val done = try {
                    if (target.routine) {
                        Central.runRoutine(ctx, target.id)
                        Slot(null, ctx.getString(R.string.feito))
                    } else {
                        val current = Central.device(ctx, target.id)
                        val after = Central.command(ctx, target.id, target.capability, !current.isOn(target.capability))
                        Slot.of(ctx, target, after)
                    }
                } catch (e: AuthError) {
                    Slot(null, ctx.getString(R.string.sem_acesso))
                } catch (e: Exception) {
                    Slot(null, ctx.getString(R.string.sem_resposta))
                }
                // Os outros itens também podem ter mudado (ex.: "power" do interruptor vale para todas as teclas).
                val fresh = try { states(ctx, items) } catch (e: Exception) { shown }
                render(ctx, id, items, fresh.replace(slot, done))
            } finally {
                pending.finish()
            }
        }
    }

    /** O que um item mostra: ligado (true/false; null = rotina, carregando ou erro) e a linha de estado. */
    data class Slot(val on: Boolean?, val text: String) {
        companion object {
            fun unknown(ctx: Context, t: Target) = Slot(null, if (t.routine) ctx.getString(R.string.rotina) else "")

            fun of(ctx: Context, t: Target, d: Device?): Slot = when {
                t.routine -> unknown(ctx, t)
                d == null -> Slot(null, ctx.getString(R.string.sem_resposta))
                !d.online -> Slot(null, ctx.getString(R.string.sem_resposta))
                d.isOn(t.capability) -> Slot(true, ctx.getString(R.string.ligado))
                else -> Slot(false, ctx.getString(R.string.desligado))
            }
        }
    }

    companion object {
        const val ACTION_TAP = "com.yanngc32.central.TOGGLE"
        const val EXTRA_SLOT = "slot"
        const val MAX = 4

        /** Último estado desenhado por widget: o toque mostra "…" no item sem apagar os outros. */
        private val last = java.util.concurrent.ConcurrentHashMap<Int, List<Slot>>()

        private val SLOTS = intArrayOf(R.id.slot0, R.id.slot1, R.id.slot2, R.id.slot3)
        private val ICONS = intArrayOf(R.id.icon0, R.id.icon1, R.id.icon2, R.id.icon3)
        private val NAMES = intArrayOf(R.id.name0, R.id.name1, R.id.name2, R.id.name3)
        private val STATES = intArrayOf(R.id.state0, R.id.state1, R.id.state2, R.id.state3)

        fun refreshAll(ctx: Context) {
            val ids = AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, DeviceWidget::class.java))
            refresh(ctx, ids)
        }

        fun refresh(ctx: Context, ids: IntArray) {
            if (ids.isEmpty()) return
            thread {
                for (id in ids) {
                    val items = WidgetPrefs.load(ctx, id)
                    if (items.isEmpty()) continue
                    val slots = try {
                        states(ctx, items)
                    } catch (e: AuthError) {
                        items.map { Slot(null, ctx.getString(R.string.sem_acesso)) }
                    } catch (e: Exception) {
                        items.map { if (it.routine) Slot.unknown(ctx, it) else Slot(null, ctx.getString(R.string.sem_resposta)) }
                    }
                    render(ctx, id, items, slots)
                }
            }
        }

        /** Uma ida à colmeia para todos os itens (a lista de aparelhos já traz o estado de cada um). */
        private fun states(ctx: Context, items: List<Target>): List<Slot> {
            val devices = if (items.any { !it.routine }) Central.devices(ctx).associateBy { it.id } else emptyMap()
            return items.map { Slot.of(ctx, it, devices[it.id]) }
        }

        private fun List<Slot>.replace(i: Int, s: Slot) = mapIndexed { j, x -> if (j == i) s else x }

        private fun icon(t: Target) = when {
            t.routine -> R.drawable.ic_w_routine
            t.capability.startsWith("switch_") -> R.drawable.ic_w_switch
            else -> when (t.kind) {
                "light" -> R.drawable.ic_w_light
                "plug" -> R.drawable.ic_w_plug
                "tv" -> R.drawable.ic_w_tv
                "ac" -> R.drawable.ic_w_ac
                "switch" -> R.drawable.ic_w_switch
                "vacuum" -> R.drawable.ic_w_vacuum
                else -> R.drawable.ic_w_other
            }
        }

        fun render(ctx: Context, id: Int, items: List<Target>, slots: List<Slot>) {
            last[id] = slots
            val manager = AppWidgetManager.getInstance(ctx)
            val opts = manager.getAppWidgetOptions(id)
            val tall = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) >= 100
            val grid = tall && items.size > 2
            val views = RemoteViews(ctx.packageName, if (grid) R.layout.widget_grid else R.layout.widget_row)
            // Em linha com 3+ itens a largura de cada um é pouca: só ícone e nome.
            val showState = grid || items.size <= 2
            if (grid && items.size == 3) views.setViewVisibility(R.id.slot3, View.INVISIBLE)
            items.take(MAX).forEachIndexed { i, t ->
                val s = slots.getOrNull(i) ?: Slot.unknown(ctx, t)
                val on = s.on == true
                views.setViewVisibility(SLOTS[i], View.VISIBLE)
                views.setInt(
                    SLOTS[i], "setBackgroundResource",
                    when {
                        on -> R.drawable.widget_slot_on
                        t.routine -> R.drawable.widget_slot_rotina
                        else -> R.drawable.widget_slot_off
                    },
                )
                val tx = ctx.getColor(if (on) R.color.widget_on_tx else R.color.widget_tx)
                views.setImageViewResource(ICONS[i], icon(t))
                views.setInt(ICONS[i], "setColorFilter", tx)
                views.setTextViewText(NAMES[i], t.label)
                views.setTextColor(NAMES[i], tx)
                views.setTextViewText(STATES[i], s.text)
                views.setTextColor(STATES[i], ctx.getColor(if (on) R.color.widget_on_tx_2 else R.color.widget_tx_2))
                views.setViewVisibility(STATES[i], if (showState && s.text.isNotEmpty()) View.VISIBLE else View.GONE)
                views.setContentDescription(SLOTS[i], listOf(t.label, s.text).filter { it.isNotEmpty() }.joinToString(", "))
                val tap = Intent(ctx, DeviceWidget::class.java)
                    .setAction(ACTION_TAP)
                    // Um Intent distinto por item: sem isso o Android junta os PendingIntents e todos tocam o mesmo.
                    .setData(Uri.parse("setefavos://widget/$id/$i"))
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                    .putExtra(EXTRA_SLOT, i)
                views.setOnClickPendingIntent(
                    SLOTS[i],
                    PendingIntent.getBroadcast(ctx, id * MAX + i, tap, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
                )
            }
            manager.updateAppWidget(id, views)
        }
    }
}

/** O que cada widget controla, por id do widget (lista em JSON; o formato antigo de 1 aparelho ainda é lido). */
object WidgetPrefs {
    private const val PREFS = "widgets"

    fun save(ctx: Context, id: Int, items: List<Target>) {
        val arr = JSONArray().apply { items.forEach { put(it.toJson()) } }
        ctx.getSharedPreferences(PREFS, 0).edit()
            .putString("$id.items", arr.toString())
            .remove("$id.device").remove("$id.cap").remove("$id.label")
            .apply()
    }

    fun load(ctx: Context, id: Int): List<Target> {
        val p = ctx.getSharedPreferences(PREFS, 0)
        p.getString("$id.items", null)?.let { json ->
            val arr = JSONArray(json)
            return (0 until arr.length()).map { Target.fromJson(arr.getJSONObject(it)) }
        }
        // Widget de antes da lista: um aparelho só.
        val device = p.getString("$id.device", null) ?: return emptyList()
        return listOf(Target(device, p.getString("$id.cap", "power")!!, p.getString("$id.label", "")!!))
    }

    fun clear(ctx: Context, id: Int) {
        ctx.getSharedPreferences(PREFS, 0).edit()
            .remove("$id.items").remove("$id.device").remove("$id.cap").remove("$id.label")
            .apply()
    }
}
