package com.yanngc32.central

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import kotlin.concurrent.thread

/**
 * Ao colocar (ou reconfigurar) o widget: marca até [DeviceWidget.MAX] itens — aparelhos, teclas do
 * interruptor e rotinas. A ordem no widget é a ordem em que foram marcados.
 */
class WidgetConfigActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return finish()
        title = getString(R.string.escolha_aparelho)

        val pad = (16 * resources.displayMetrics.density).toInt()
        val hint = TextView(this).apply {
            text = getString(R.string.escolha_ate, DeviceWidget.MAX)
            setPadding(pad, pad / 2, pad, pad / 2)
        }
        val list = ListView(this).apply { choiceMode = ListView.CHOICE_MODE_MULTIPLE }
        val done = Button(this).apply { text = getString(R.string.colocar_widget); isEnabled = false }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(hint)
            addView(list, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(done)
        })

        thread {
            val targets = try {
                val devices = Central.devices(this).flatMap { d ->
                    if (d.keys.isNotEmpty()) d.keys.map { (cap, label) -> Target(d.id, cap, label, d.kind) }
                    else if (d.state.has("power")) listOf(Target(d.id, "power", d.name, d.kind))
                    else emptyList()
                }
                val routines = try {
                    Central.routines(this).map { Target(it.id, "run", it.name, routine = true) }
                } catch (e: AuthError) {
                    throw e
                } catch (e: Exception) {
                    emptyList()
                }
                devices + routines
            } catch (e: AuthError) {
                null
            } catch (e: Exception) {
                emptyList()
            }
            runOnUiThread {
                if (targets == null || targets.isEmpty()) {
                    val msg = if (targets == null) R.string.abra_o_app else R.string.sem_resposta
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                    return@runOnUiThread finish()
                }
                val rotina = getString(R.string.rotina)
                val labels = targets.map { if (it.routine) "$rotina · ${it.label}" else it.label }
                list.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_multiple_choice, labels)

                // Ordem de marcação; ao reconfigurar, começa com o que o widget já tem.
                val picked = mutableListOf<Int>()
                for (old in WidgetPrefs.load(this, widgetId)) {
                    val i = targets.indexOfFirst { it.id == old.id && it.capability == old.capability && it.routine == old.routine }
                    if (i >= 0 && picked.size < DeviceWidget.MAX) {
                        picked += i
                        list.setItemChecked(i, true)
                    }
                }
                done.isEnabled = picked.isNotEmpty()

                list.setOnItemClickListener { _, _, pos, _ ->
                    if (list.isItemChecked(pos)) {
                        if (picked.size >= DeviceWidget.MAX) {
                            list.setItemChecked(pos, false)
                            Toast.makeText(this, getString(R.string.no_maximo, DeviceWidget.MAX), Toast.LENGTH_SHORT).show()
                        } else {
                            picked += pos
                        }
                    } else {
                        picked.remove(pos)
                    }
                    done.isEnabled = picked.isNotEmpty()
                }
                done.setOnClickListener {
                    if (picked.isEmpty()) {
                        Toast.makeText(this, R.string.escolha_um, Toast.LENGTH_SHORT).show()
                        return@setOnClickListener
                    }
                    WidgetPrefs.save(this, widgetId, picked.map { targets[it] })
                    DeviceWidget.refresh(this, intArrayOf(widgetId))
                    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
                    finish()
                }
            }
        }
    }
}
