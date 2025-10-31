// File: 04-core-code/services/workflow-service.js

import { initialState } from '../config/initial-state.js';
import { EVENTS, DOM_IDS } from '../config/constants.js';
import * as uiActions from '../actions/ui-actions.js';
import * as quoteActions from '../actions/quote-actions.js';
import { paths } from '../config/paths.js';

/**
 * @fileoverview A dedicated service for coordinating complex, multi-step user workflows.
 * This service takes complex procedural logic out of the AppController.
 */
export class WorkflowService {
    constructor({ eventAggregator, stateService, fileService, calculationService, productFactory, detailConfigView, quoteGeneratorService }) {
        this.eventAggregator = eventAggregator;
        this.stateService = stateService;
        this.fileService = fileService;
        this.calculationService = calculationService;
        this.productFactory = productFactory;
        this.detailConfigView = detailConfigView;
        this.quoteGeneratorService = quoteGeneratorService;
        this.quotePreviewComponent = null; 

        console.log("WorkflowService Initialized.");
    }

    setQuotePreviewComponent(component) {
        this.quotePreviewComponent = component;
    }

    async handlePrintableQuoteRequest() {
        try {
            const { quoteData, ui } = this.stateService.getState();
            const f3Data = this._getF3OverrideData();

            const finalHtml = this.quoteGeneratorService.generateQuoteHtml(quoteData, ui, f3Data);

            if (finalHtml) {
                const blob = new Blob([finalHtml], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');

            } else {
                throw new Error("QuoteGeneratorService did not return HTML. Templates might not be loaded.");
            }

        } catch (error) {
            console.error("Error generating printable quote:", error);
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, {
                message: "Failed to generate quote preview. See console for details.",
                type: 'error',
            });
        }
    }

    _getF3OverrideData() {
        const getValue = (id) => document.getElementById(id)?.value || '';
        return {
            quoteId: getValue('f3-quote-id'),
            issueDate: getValue('f3-issue-date'),
            dueDate: getValue('f3-due-date'),
            customerName: getValue('f3-customer-name'),
            customerAddress: getValue('f3-customer-address'),
            customerPhone: getValue('f3-customer-phone'),
            customerEmail: getValue('f3-customer-email'),
            finalOfferPrice: getValue('f3-final-offer-price'),
            generalNotes: getValue('f3-general-notes'),
            termsConditions: getValue('f3-terms-conditions'),
        };
    }

    handleF1TabActivation() {
        const { quoteData } = this.stateService.getState();
        const productStrategy = this.productFactory.getProductStrategy(quoteData.currentProduct);
        const { updatedQuoteData } = this.calculationService.calculateAndSum(quoteData, productStrategy);

        this.stateService.dispatch(quoteActions.setQuoteData(updatedQuoteData));
    }

    handleNavigationToDetailView() {
        const { ui } = this.stateService.getState();
        if (ui.currentView === 'QUICK_QUOTE') {
            this.stateService.dispatch(uiActions.setCurrentView('DETAIL_CONFIG'));
            this.detailConfigView.activateTab('k1-tab');
        } else {
            this.stateService.dispatch(uiActions.setCurrentView('QUICK_QUOTE'));
            this.stateService.dispatch(uiActions.setVisibleColumns(initialState.ui.visibleColumns));
        }
    }

    handleNavigationToQuickQuoteView() {
        this.stateService.dispatch(uiActions.setCurrentView('QUICK_QUOTE'));
        this.stateService.dispatch(uiActions.setVisibleColumns(initialState.ui.visibleColumns));
    }

    handleTabSwitch({ tabId }) {
        this.detailConfigView.activateTab(tabId);
    }

    handleUserRequestedLoad() {
        const { quoteData } = this.stateService.getState();
        const productKey = quoteData.currentProduct;
        const items = quoteData.products[productKey] ? quoteData.products[productKey].items : [];
        const hasData = items.length > 1 || (items.length === 1 && (items[0].width || items[0].height));

        if (hasData) {
            this.eventAggregator.publish(EVENTS.SHOW_LOAD_CONFIRMATION_DIALOG);
        } else {
            this.eventAggregator.publish(EVENTS.TRIGGER_FILE_LOAD);
        }
    }

    handleLoadDirectly() {
        this.eventAggregator.publish(EVENTS.TRIGGER_FILE_LOAD);
    }

    handleFileLoad({ fileName, content }) {
        const result = this.fileService.parseFileContent(fileName, content);
        if (result.success) {
            this.stateService.dispatch(quoteActions.setQuoteData(result.data));
            this.stateService.dispatch(uiActions.resetUi());
            this.stateService.dispatch(uiActions.setSumOutdated(true));
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: result.message });
        } else {
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: result.message, type: 'error' });
        }
    }

    handleF1DiscountChange({ percentage }) {
        this.stateService.dispatch(uiActions.setF1DiscountPercentage(percentage));
    }

    /**
     * [NEW] A helper method to create a deep copy of quoteData and inject the F1 panel state into it.
     * This is the implementation of "Procedure A".
     * @returns {object} A new quoteData object ready for saving or exporting.
     */
    _getQuoteDataWithF1Snapshot() {
        const { quoteData, ui } = this.stateService.getState();
        
        const dataWithSnapshot = JSON.parse(JSON.stringify(quoteData));
        const f1State = ui.f1;

        if (dataWithSnapshot.f1Snapshot) {
            dataWithSnapshot.f1Snapshot.remote_1ch_qty = f1State.remote_1ch_qty;
            dataWithSnapshot.f1Snapshot.remote_16ch_qty = f1State.remote_16ch_qty;
            dataWithSnapshot.f1Snapshot.dual_combo_qty = f1State.dual_combo_qty;
            dataWithSnapshot.f1Snapshot.dual_slim_qty = f1State.dual_slim_qty;
            dataWithSnapshot.f1Snapshot.discountPercentage = f1State.discountPercentage;
        }
        
        return dataWithSnapshot;
    }
    
    /**
     * [NEW & MOVED] Handles the save to JSON request, now with F1 state snapshotting.
     */
    handleSaveToFile() {
        const dataToSave = this._getQuoteDataWithF1Snapshot();
        const result = this.fileService.saveToJson(dataToSave);
        const notificationType = result.success ? 'info' : 'error';
        this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: result.message, type: notificationType });
    }

    /**
     * [NEW & MOVED] Handles the export to CSV request, now with F1 state snapshotting.
     */
    handleExportCSV() {
        const dataToExport = this._getQuoteDataWithF1Snapshot();
        const result = this.fileService.exportToCsv(dataToExport);
        const notificationType = result.success ? 'info' : 'error';
        this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: result.message, type: notificationType });
    }

    /**
     * [NEW & MOVED] Handles the reset request.
     */
    handleReset() {
        if (window.confirm("This will clear all data. Are you sure?")) {
            this.stateService.dispatch(quoteActions.resetQuoteData());
            this.stateService.dispatch(uiActions.resetUi());
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: 'Quote has been reset.' });
        }
    }
}