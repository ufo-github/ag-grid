/// <reference path="../utils.ts" />
/// <reference path="../constants.ts" />
/// <reference path="../entities/column.ts" />
/// <reference path="../entities/columnGroup.ts" />
/// <reference path="../columnChangeEvent.ts" />
/// <reference path="../masterSlaveService.ts" />
/// <reference path="./displayedGroupCreator.ts" />
/// <reference path="./balancedColumnTreeBuilder.ts" />

module ag.grid {

    var _ = Utils;
    var constants = Constants;

    export class ColumnApi {
        constructor(private _columnController: ColumnController) {}
        public sizeColumnsToFit(gridWidth: any): void { this._columnController.sizeColumnsToFit(gridWidth); }
        public hideColumns(colIds: any, hide: any): void { this._columnController.hideColumns(colIds, hide); }
        public columnGroupOpened(group: ColumnGroup, newValue: boolean): void { this._columnController.columnGroupOpened(group, newValue); }
        public getColumnGroup(name: string, instanceId?: number): ColumnGroup { return this._columnController.getColumnGroup(name, instanceId); }
        public getDisplayNameForCol(column: any): string { return this._columnController.getDisplayNameForCol(column); }
        public getColumn(key: any): Column { return this._columnController.getColumn(key); }
        public setState(columnState: any): void { return this._columnController.setState(columnState); }
        public getState(): [any] { return this._columnController.getState(); }
        public isPinning(): boolean { return this._columnController.isPinning(); }
        public getDisplayedColAfter(col: Column): Column { return this._columnController.getDisplayedColAfter(col); }
        public getDisplayedColBefore(col: Column): Column { return this._columnController.getDisplayedColBefore(col); }
        public setColumnVisible(key: Column|ColDef|String, visible: boolean): void { this._columnController.setColumnVisible(key, visible); }
        public setColumnPinned(key: Column|ColDef|String, visible: boolean): void { this._columnController.setColumnPinned(key, visible); }

        public getAllColumns(): Column[] { return this._columnController.getAllColumns(); }
        public getDisplayedLeftColumns(): Column[] { return this._columnController.getDisplayedLeftColumns(); }
        public getDisplayedCenterColumns(): Column[] { return this._columnController.getDisplayedCenterColumns(); }
        public getPivotedColumns(): Column[] { return this._columnController.getPivotedColumns(); }
        public getValueColumns(): Column[] { return this._columnController.getValueColumns(); }
        public moveColumn(fromIndex: number, toIndex: number): void { this._columnController.moveColumn(fromIndex, toIndex); }
        public movePivotColumn(fromIndex: number, toIndex: number): void { this._columnController.movePivotColumn(fromIndex, toIndex); }
        public setColumnAggFunction(column: Column, aggFunc: string): void { this._columnController.setColumnAggFunction(column, aggFunc); }
        public setColumnWidth(column: Column, newWidth: number, finished: boolean = true): void { this._columnController.setColumnWidth(column, newWidth, finished); }
        public removeValueColumn(column: Column): void { this._columnController.removeValueColumn(column); }
        public addValueColumn(column: Column): void { this._columnController.addValueColumn(column); }
        public removePivotColumn(column: Column): void { this._columnController.removePivotColumn(column); }
        public addPivotColumn(column: Column): void { this._columnController.addPivotColumn(column); }
        public getLeftHeaderGroups(): ColumnGroupChild[] { return this._columnController.getLeftHeaderGroups(); }
        public getCenterHeaderGroups(): ColumnGroupChild[] { return this._columnController.getCenterHeaderGroups(); }
        public hideColumn(colId: any, hide: any): void { this._columnController.hideColumns([colId], hide); }
    }

    export class ColumnController {

        private gridOptionsWrapper: GridOptionsWrapper;
        private angularGrid: Grid;
        private selectionRendererFactory: SelectionRendererFactory;
        private expressionService: ExpressionService;
        private masterSlaveController: MasterSlaveService;
        private balancedColumnTreeBuilder: BalancedColumnTreeBuilder;
        private displayedGroupCreator: DisplayedGroupCreator;

        // these are the columns provided by the client. this doesn't change, even if the
        // order or state of the columns and groups change. it will only change if the client
        // provides a new set of column definitions. otherwise this tree is used to build up
        // the groups for displaying.
        private originalBalancedTree: ColumnGroupChild[];
        // these are every single column, regardless of whether they are shown on
        // screen or not (cols can be missing if visible=false or the group they are
        // in is closed). basically it's the leaf level nodes of the tree above (originalBalancedTree)
        private allColumns: Column[]; // every column available

        // these are the columns actually shown on the screen. used by the header renderer,
        // as header needs to know about column groups and the tree structure.
        private displayedLeftColumnTree: ColumnGroupChild[];
        private displayedCentreColumnTree: ColumnGroupChild[];

        // these are the lists used by the rowRenderer to render nodes. almost the leaf nodes of the above
        // displayed trees, however it also takes into account if the groups are open or not.
        private displayedLeftColumns: Column[];
        private displayedCenterColumns: Column[];

        private headerRowCount = 0;

        private pivotColumns: Column[];
        private valueColumns: Column[];

        private groupAutoColumn: Column;

        private setupComplete = false;
        private valueService: ValueService;

        private eventService: EventService;
        private columnUtils: ColumnUtils;

        constructor() {
        }

        public init(angularGrid: Grid, selectionRendererFactory: SelectionRendererFactory,
                    gridOptionsWrapper: GridOptionsWrapper, expressionService: ExpressionService,
                    valueService: ValueService, masterSlaveController: MasterSlaveService,
                    eventService: EventService, balancedColumnTreeBuilder: BalancedColumnTreeBuilder,
                    displayedGroupCreator: DisplayedGroupCreator, columnUtils: ColumnUtils) {
            this.gridOptionsWrapper = gridOptionsWrapper;
            this.angularGrid = angularGrid;
            this.selectionRendererFactory = selectionRendererFactory;
            this.expressionService = expressionService;
            this.valueService = valueService;
            this.masterSlaveController = masterSlaveController;
            this.eventService = eventService;
            this.balancedColumnTreeBuilder = balancedColumnTreeBuilder;
            this.displayedGroupCreator = displayedGroupCreator;
            this.columnUtils = columnUtils;
        }

        private getColumnsFromTree(rootColumns: OriginalColumnGroupChild[]): Column[] {
            var result: Column[] = [];
            recursiveFindColumns(rootColumns);
            return result;

            function recursiveFindColumns(childColumns: OriginalColumnGroupChild[]): void {
                for (var i = 0; i<childColumns.length; i++) {
                    var child = childColumns[i];
                    if (child instanceof Column) {
                        result.push(<Column>child);
                    } else if (child instanceof OriginalColumnGroup) {
                        recursiveFindColumns((<OriginalColumnGroup>child).getChildren());
                    }
                }
            }
        }

        private getAllColumnGroups(): ColumnGroupChild[] {
            if (this.displayedLeftColumnTree && this.displayedCentreColumnTree) {
                return this.displayedLeftColumnTree.concat(this.displayedCentreColumnTree);
            } else {
                return null;
            }
        }

        public getColumnApi(): ColumnApi {
            return new ColumnApi(this);
        }

        public isSetupComplete(): boolean {
            return this.setupComplete;
        }

        // + gridPanel -> for resizing the body and setting top margin
        public getHeaderRowCount(): number {
            return this.headerRowCount;
        }

        // + headerRenderer -> setting pinned body width
        public getLeftHeaderGroups(): ColumnGroupChild[] {
            return this.displayedLeftColumnTree;
        }
        // + headerRenderer -> setting pinned body width
        public getCenterHeaderGroups(): ColumnGroupChild[] {
            return this.displayedCentreColumnTree;
        }

        // + csvCreator
        public getAllDisplayedColumns(): Column[] {
            return this.displayedLeftColumns.concat(this.displayedCenterColumns);
        }

        // used by:
        // + angularGrid -> setting pinned body width
        public getPinnedContainerWidth() {
            return this.getWithOfColsInList(this.displayedLeftColumns);
        }

        public addPivotColumn(column: Column): void {
            if (this.allColumns.indexOf(column) < 0) {
                console.warn('not a valid column: ' + column);
                return;
            }
            if (this.pivotColumns.indexOf(column) >= 0) {
                console.warn('column is already a value column');
                return;
            }
            this.pivotColumns.push(column);
            // because we could be taking out 'pivot' columns, the displayed
            // columns may differ, so need to work out all the columns again
            this.updateModel();
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_PIVOT_CHANGE);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_PIVOT_CHANGE, event);
        }

        public removePivotColumn(column: Column): void {
            if (this.pivotColumns.indexOf(column) < 0) {
                console.warn('column not a pivot');
                return;
            }
            _.removeFromArray(this.pivotColumns, column);
            this.updateModel();
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_PIVOT_CHANGE);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_PIVOT_CHANGE, event);
        }

        public addValueColumn(column: Column): void {
            if (this.allColumns.indexOf(column) < 0) {
                console.warn('not a valid column: ' + column);
                return;
            }
            if (this.valueColumns.indexOf(column) >= 0) {
                console.warn('column is already a value column');
                return;
            }
            if (!column.aggFunc) { // defualt to SUM if aggFunc is missing
                column.aggFunc = constants.SUM;
            }
            this.valueColumns.push(column);
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_VALUE_CHANGE);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_VALUE_CHANGE, event);
        }

        public removeValueColumn(column: Column): void {
            if (this.valueColumns.indexOf(column) < 0) {
                console.warn('column not a value');
                return;
            }
            _.removeFromArray(this.valueColumns, column);
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_VALUE_CHANGE);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_VALUE_CHANGE, event);
        }

        private doesColumnExistInGrid(column: Column): boolean {
            var columnInAllColumns = this.allColumns.indexOf(column) >= 0;
            var columnIsGroupAutoColumn = column === this.groupAutoColumn;
            return columnInAllColumns || columnIsGroupAutoColumn;
        }

        public setColumnWidth(column: Column, newWidth: number, finished: boolean): void {
            if (!this.doesColumnExistInGrid(column)) {
                console.warn('column does not exist');
                return;
            }

            if (newWidth < column.getMinimumWidth()) {
                newWidth = column.getMinimumWidth();
            }

            if (column.isGreaterThanMax(newWidth)) {
                newWidth = column.colDef.maxWidth;
            }

            // check for change first, to avoid unnecessary firing of events
            // however we always fire 'finished' events. this is important
            // when groups are resized, as if the group is changing slowly,
            // eg 1 pixel at a time, then each change will fire change events
            // in all the columns in the group, but only one with get the pixel.
            if (finished || column.getActualWidth() !== newWidth) {
                column.setActualWidth(newWidth);

                var event = new ColumnChangeEvent(Events.EVENT_COLUMN_RESIZED).withColumn(column).withFinished(finished);
                this.eventService.dispatchEvent(Events.EVENT_COLUMN_RESIZED, event);
            }
        }

        private updateGroupWidthsAfterColumnResize(column: Column) {
            console.error('dont call this method, trying to delete it');
            var allColumnGroups = this.getAllColumnGroups();
            if (allColumnGroups) {
                allColumnGroups.forEach( (columnGroup: ColumnGroup) => {
                    if (columnGroup.getDisplayedChildren().indexOf(column) >= 0) {
                        //columnGroup.calculateActualWidth();
                    }
                });
            }
        }

        public setColumnAggFunction(column: Column, aggFunc: string): void {
            column.aggFunc = aggFunc;
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_VALUE_CHANGE);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_VALUE_CHANGE, event);
        }

        public movePivotColumn(fromIndex: number, toIndex: number): void {
            var column = this.pivotColumns[fromIndex];
            this.pivotColumns.splice(fromIndex, 1);
            this.pivotColumns.splice(toIndex, 0, column);
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_PIVOT_CHANGE);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_PIVOT_CHANGE, event);
        }

        public moveColumn(fromIndex: number, toIndex: number): void {
            var column = this.allColumns[fromIndex];
            this.allColumns.splice(fromIndex, 1);
            this.allColumns.splice(toIndex, 0, column);
            this.updateModel();
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_MOVED)
                .withFromIndex(fromIndex)
                .withToIndex(toIndex);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_MOVED, event);
        }

        // used by:
        // + angularGrid -> for setting body width
        // + rowController -> setting main row widths (when inserting and resizing)
        public getBodyContainerWidth(): number {
            var result = this.getWithOfColsInList(this.displayedCenterColumns);
            return result;
        }

        // + rowController
        public getValueColumns(): Column[] {
            return this.valueColumns;
        }

        // + toolPanel
        public getPivotedColumns(): Column[] {
            return this.pivotColumns;
        }

        // + rowController -> while inserting rows
        public getDisplayedCenterColumns(): Column[] {
            return this.displayedCenterColumns;
        }
        // + rowController -> while inserting rows
        public getDisplayedLeftColumns(): Column[] {
            return this.displayedLeftColumns;
        }

        // used by:
        // + inMemoryRowController -> sorting, building quick filter text
        // + headerRenderer -> sorting (clearing icon)
        public getAllColumns(): Column[] {
            return this.allColumns;
        }

        public setColumnVisible(key: Column|ColDef|String, visible: boolean): void {
            var column = this.getColumn(key);
            if (!column) {return;}

            column.visible = visible;

            this.updateModel();
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_VISIBLE).withColumn(column);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_VISIBLE, event);
        }

        public setColumnPinned(key: Column|ColDef|String, pinned: boolean): void {
            var column = this.getColumn(key);
            if (!column) {return;}

            column.pinned = pinned;

            this.updateModel();
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_PINNED).withColumn(column);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_PINNED, event);
        }

        public getDisplayedColBefore(col: any): Column {
            var allDisplayedColumns = this.getAllDisplayedColumns();
            var oldIndex = allDisplayedColumns.indexOf(col);
            if (oldIndex > 0) {
                return allDisplayedColumns[oldIndex - 1];
            } else {
                return null;
            }
        }

        // used by:
        // + rowRenderer -> for navigation
        public getDisplayedColAfter(col: Column): Column {
            var allDisplayedColumns = this.getAllDisplayedColumns();
            var oldIndex = allDisplayedColumns.indexOf(col);
            if (oldIndex < (allDisplayedColumns.length - 1)) {
                return allDisplayedColumns[oldIndex + 1];
            } else {
                return null;
            }
        }

        public isPinning(): boolean {
            return this.displayedLeftColumns.length > 0;
        }

        public getState(): [any] {
            if (!this.allColumns || this.allColumns.length < 0) {
                return <any>[];
            }
            var result = <any>[];
            for (var i = 0; i < this.allColumns.length; i++) {
                var column = this.allColumns[i];
                var pivotIndex = this.pivotColumns.indexOf(column);
                var resultItem = {
                    colId: column.getColId(),
                    hide: !column.visible,
                    aggFunc: column.aggFunc ? column.aggFunc : null,
                    width: column.getActualWidth(),
                    pinned: column.pinned,
                    pivotIndex: pivotIndex >= 0 ? pivotIndex : null
                };
                result.push(resultItem);
            }
            return result;
        }

        public setState(columnState: any): void {
            var oldColumnList = this.allColumns;
            this.allColumns = [];
            this.pivotColumns = [];
            this.valueColumns = [];
            var that = this;

            _.forEach(columnState, function (stateItem: any) {
                var oldColumn = _.find(oldColumnList, 'colId', stateItem.colId);
                if (!oldColumn) {
                    console.warn('ag-grid: column ' + stateItem.colId + ' not found');
                    return;
                }
                // following ensures we are left with boolean true or false, eg converts (null, undefined, 0) all to true
                oldColumn.visible = stateItem.hide ? false : true;
                // checks for 'true', otherwise false
                oldColumn.pinned = stateItem.pinned === true;
                // if width provided and valid, use it, otherwise stick with the old width
                oldColumn.actualWidth = stateItem.width >= constants.MIN_COL_WIDTH ? stateItem.width : oldColumn.actualWidth;
                // accept agg func only if valid
                var aggFuncValid = [constants.MIN, constants.MAX, constants.SUM].indexOf(stateItem.aggFunc) >= 0;
                if (aggFuncValid) {
                    oldColumn.aggFunc = stateItem.aggFunc;
                    that.valueColumns.push(oldColumn);
                } else {
                    oldColumn.aggFunc = null;
                }
                // if pivot
                if (typeof stateItem.pivotIndex === 'number' && stateItem.pivotIndex >= 0) {
                    that.pivotColumns.push(oldColumn);
                }
                that.allColumns.push(oldColumn);
                oldColumnList.splice(oldColumnList.indexOf(oldColumn), 1);
            });

            // anything left over, we got no data for, so add in the column as non-value, non-pivot and hidden
            _.forEach(oldColumnList, function (oldColumn: any) {
                oldColumn.visible = false;
                oldColumn.aggFunc = null;
                oldColumn.pinned = false;
                that.allColumns.push(oldColumn);
            });

            this.pivotColumns.sort(function (colA: any, colB: any): number {
                return colA.pivotIndex - colB.pivotIndex;
            });

            this.updateModel();

            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_EVERYTHING_CHANGED);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_EVERYTHING_CHANGED, event);
        }

        public getColumns(keys: any[]): Column[] {
            var foundColumns: Column[] = [];
            if (keys) {
                keys.forEach( (key: any) => {
                    var column = this.getColumn(key);
                    if (column) {
                        foundColumns.push(column);
                    }
                });
            }
            return foundColumns;
        }

        public getColumn(key: any): Column {
            if (!key) {return null;}

            for (var i = 0; i < this.allColumns.length; i++) {
                if (colMatches(this.allColumns[i])) {
                    return this.allColumns[i];
                }
            }

            if (colMatches(this.groupAutoColumn)) {
                return this.groupAutoColumn;
            }

            function colMatches(column: Column): boolean {
                var columnMatches = column === key;
                var colDefMatches = column.colDef === key;
                var idMatches = column.getColId() === key;
                return columnMatches || colDefMatches || idMatches;
            }

            console.log('could not find column for key ' + key);

            return null;
        }

        public getDisplayNameForCol(column: any): string {

            var colDef = column.colDef;
            var headerValueGetter = colDef.headerValueGetter;

            if (headerValueGetter) {
                var params = {
                    colDef: colDef,
                    api: this.gridOptionsWrapper.getApi(),
                    context: this.gridOptionsWrapper.getContext()
                };

                if (typeof headerValueGetter === 'function') {
                    // valueGetter is a function, so just call it
                    return headerValueGetter(params);
                } else if (typeof headerValueGetter === 'string') {
                    // valueGetter is an expression, so execute the expression
                    return this.expressionService.evaluate(headerValueGetter, params);
                } else {
                    console.warn('ag-grid: headerValueGetter must be a function or a string');
                }

            } else if (colDef.displayName) {
                console.warn("ag-grid: Found displayName " + colDef.displayName + ", please use headerName instead, displayName is deprecated.");
                return colDef.displayName;
            } else {
                return colDef.headerName;
            }
        }

        // returns the group with matching colId and instanceId. If instanceId is missing,
        // matches only on the colId.
        public getColumnGroup(colId: string, instanceId?: number): ColumnGroup {
            if (!colId) {return null;}

            var allColumnGroups = this.getAllColumnGroups();
            var checkInstanceId = typeof instanceId === 'number';
            var result: ColumnGroup = null;

            this.columnUtils.deptFirstAllColumnTreeSearch(allColumnGroups, (child: ColumnGroupChild)=> {
                if (child instanceof ColumnGroup) {
                    var columnGroup = <ColumnGroup> child;
                    var matched: boolean;
                    if (checkInstanceId) {
                        matched = colId === columnGroup.getColId() && instanceId === columnGroup.getInstanceId();
                    } else {
                        matched = colId === columnGroup.getColId();
                    }
                    if (matched) {
                        result = columnGroup;
                    }
                }
            });

            return result;
        }

        // called by angularGrid
        public onColumnsChanged() {
            var columnDefs = this.gridOptionsWrapper.getColumnDefs();

            var balancedTreeResult = this.balancedColumnTreeBuilder.createBalancedColumnGroups(columnDefs);
            this.originalBalancedTree = balancedTreeResult.balancedTree;
            this.headerRowCount = balancedTreeResult.treeDept + 1;

            this.allColumns = this.getColumnsFromTree(this.originalBalancedTree);
            this.createPivotColumns();
            this.createValueColumns();
            this.updateModel();
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_EVERYTHING_CHANGED);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_EVERYTHING_CHANGED, event);
            this.setupComplete = true;
        }

        // called by headerRenderer - when a header is opened or closed
        public columnGroupOpened(group: ColumnGroup, newValue: boolean): void {
            group.expanded = newValue;
            this.updateGroupsAndDisplayedColumns();
            var event = new ColumnChangeEvent(Events.EVENT_COLUMN_GROUP_OPENED).withColumnGroup(group);
            this.eventService.dispatchEvent(Events.EVENT_COLUMN_GROUP_OPENED, event);
        }

        // called from API
        public hideColumns(colIds: any, hide: any) {
            var updatedCols: Column[] = [];
            this.allColumns.forEach( (column: Column) => {
                var idThisCol = column.getColId();
                var hideThisCol = colIds.indexOf(idThisCol) >= 0;
                var newVisible = !hide;
                if (hideThisCol && column.visible !== newVisible) {
                    column.visible = newVisible;
                    updatedCols.push(column);
                }
            });

            if (updatedCols.length>0) {
                this.updateModel();
                updatedCols.forEach( (column: Column) => {
                    var event = new ColumnChangeEvent(Events.EVENT_COLUMN_VISIBLE)
                        .withColumn(column);
                    this.eventService.dispatchEvent(Events.EVENT_COLUMN_VISIBLE, event);
                });
            }
        }

        private updateModel() {
            // following 3 methods are only called from here
            this.createGroupAutoColumn();
            var visibleColumns = this.updateVisibleColumns();

            // only called from here
            this.buildAllGroups(visibleColumns);
            // this is also called when a group is opened or closed
            this.updateGroupsAndDisplayedColumns();
        }

        private updateGroupsAndDisplayedColumns() {
            this.updateGroups();
            this.updateDisplayedColumnsFromGroups();
        }

        private updateDisplayedColumnsFromGroups() {
            // if grouping, then only show col as per group rules
            this.displayedLeftColumns = [];
            this.displayedCenterColumns = [];

            this.columnUtils.deptFirstDisplayedColumnTreeSearch(this.displayedLeftColumnTree, (child: ColumnGroupChild)=> {
                if (child instanceof Column) {
                    this.displayedLeftColumns.push(child);
                }
            });

            this.columnUtils.deptFirstDisplayedColumnTreeSearch(this.displayedCentreColumnTree, (child: ColumnGroupChild)=> {
                if (child instanceof Column) {
                    this.displayedCenterColumns.push(child);
                }
            });
        }

        // called from api
        public sizeColumnsToFit(gridWidth: any): void {
            // avoid divide by zero
            var allDisplayedColumns = this.getAllDisplayedColumns();

            if (gridWidth <= 0 || allDisplayedColumns.length === 0) {
                return;
            }

            var colsToNotSpread = _.filter(allDisplayedColumns, (column: Column): boolean => {
                return column.colDef.suppressSizeToFit === true;
            });
            var colsToSpread = _.filter(allDisplayedColumns, (column: Column): boolean => {
                return column.colDef.suppressSizeToFit !== true;
            });

            // make a copy of the cols that are going to be resized
            var colsToFireEventFor = colsToSpread.slice(0);

            var finishedResizing = false;
            while (!finishedResizing) {
                finishedResizing = true;
                var availablePixels = gridWidth - getTotalWidth(colsToNotSpread);
                if (availablePixels <= 0) {
                    // no width, set everything to minimum
                    colsToSpread.forEach( (column: Column) => {
                        column.setMinimum();
                        this.updateGroupWidthsAfterColumnResize(column);
                    });
                } else {
                    var scale = availablePixels / getTotalWidth(colsToSpread);
                    // we set the pixels for the last col based on what's left, as otherwise
                    // we could be a pixel or two short or extra because of rounding errors.
                    var pixelsForLastCol = availablePixels;
                    // backwards through loop, as we are removing items as we go
                    for (var i = colsToSpread.length - 1; i >= 0; i--) {
                        var column = colsToSpread[i];
                        var newWidth = Math.round(column.getActualWidth() * scale);
                        if (newWidth < column.getMinimumWidth()) {
                            column.setMinimum();
                            moveToNotSpread(column);
                            finishedResizing = false;
                        } else if (column.isGreaterThanMax(newWidth)) {
                            column.setActualWidth(column.colDef.maxWidth);
                            moveToNotSpread(column);
                            finishedResizing = false;
                        } else {
                            var onLastCol = i === 0;
                            if (onLastCol) {
                                column.setActualWidth(pixelsForLastCol);
                            } else {
                                pixelsForLastCol -= newWidth;
                                column.setActualWidth(newWidth);
                            }
                        }
                        this.updateGroupWidthsAfterColumnResize(column);
                    }
                }
            }

            // widths set, refresh the gui
            colsToFireEventFor.forEach( (column: Column) => {
                var event = new ColumnChangeEvent(Events.EVENT_COLUMN_RESIZED).withColumn(column);
                this.eventService.dispatchEvent(Events.EVENT_COLUMN_RESIZED, event);
            });

            function moveToNotSpread(column: Column) {
                _.removeFromArray(colsToSpread, column);
                colsToNotSpread.push(column);
            }

            function getTotalWidth(columns: Column[]): number {
                var result = 0;
                for (var i = 0; i<columns.length; i++) {
                    result += columns[i].getActualWidth();
                }
                return result;
            }
        }

        private buildAllGroups(visibleColumns: Column[]) {
            var leftVisibleColumns = _.filter(visibleColumns, (column)=> {
                return column.pinned;
            });

            var centerVisibleColumns = _.filter(visibleColumns, (column)=> {
                return !column.pinned;
            });

            this.displayedLeftColumnTree = this.displayedGroupCreator.createDisplayedGroups(leftVisibleColumns, this.originalBalancedTree);
            this.displayedCentreColumnTree = this.displayedGroupCreator.createDisplayedGroups(centerVisibleColumns, this.originalBalancedTree);
        }

        private updateGroups(): void {
            var allGroups = this.getAllColumnGroups();
            this.columnUtils.deptFirstAllColumnTreeSearch(allGroups, (child: ColumnGroupChild)=> {
                if (child instanceof ColumnGroup) {
                    var group = <ColumnGroup> child;
                    group.calculateDisplayedColumns();
                }
            });
        }

        private createGroupAutoColumn(): void {

            // see if we need to insert the default grouping column
            var needAGroupColumn = this.pivotColumns.length > 0
                && !this.gridOptionsWrapper.isGroupSuppressAutoColumn()
                && !this.gridOptionsWrapper.isGroupUseEntireRow()
                && !this.gridOptionsWrapper.isGroupSuppressRow();

            if (needAGroupColumn) {
                // if one provided by user, use it, otherwise create one
                var groupColDef = this.gridOptionsWrapper.getGroupColumnDef();
                if (!groupColDef) {
                    var localeTextFunc = this.gridOptionsWrapper.getLocaleTextFunc();
                    groupColDef = {
                        headerName: localeTextFunc('group', 'Group'),
                        cellRenderer: {
                            renderer: 'group'
                        }
                    };
                }
                var groupColumnWidth = this.columnUtils.calculateColInitialWidth(groupColDef);
                var colId = 'ag-Grid-AutoColumn';
                this.groupAutoColumn = new Column(groupColDef, groupColumnWidth, colId);
            } else {
                this.groupAutoColumn = null;
            }
        }

        private updateVisibleColumns(): Column[] {
            var visibleColumns: Column[] = [];

            if (this.groupAutoColumn) {
                visibleColumns.push(this.groupAutoColumn);
            }

            for (var i = 0; i < this.allColumns.length; i++) {
                var column = this.allColumns[i];
                var hideBecauseOfPivot = this.pivotColumns.indexOf(column) >= 0
                    && this.gridOptionsWrapper.isGroupHidePivotColumns();
                if (column.visible && !hideBecauseOfPivot) {
                    column.index = visibleColumns.length;
                    visibleColumns.push(this.allColumns[i]);
                }
            }

            return visibleColumns;
        }

        private createPivotColumns(): void {
            this.pivotColumns = [];
            var groupKeys = this.gridOptionsWrapper.getGroupKeys();
            if (!groupKeys || groupKeys.length <= 0) {
                return;
            }
            for (var i = 0; i < groupKeys.length; i++) {
                var groupKey = groupKeys[i];
                var column = this.getColumn(groupKey);
                if (!column) {
                    column = this.createDummyColumn(groupKey);
                }
                this.pivotColumns.push(column);
            }
        }

        private createValueColumns(): void {
            this.valueColumns = [];

            // override with columns that have the aggFunc specified explicitly
            for (var i = 0; i < this.allColumns.length; i++) {
                var column = this.allColumns[i];
                if (column.colDef.aggFunc) {
                    column.aggFunc = column.colDef.aggFunc;
                    this.valueColumns.push(column);
                }
            }
        }

        private createDummyColumn(field: any): Column {
            throw 'no longer allowing this';
            //var colDef = {
            //    field: field,
            //    headerName: field,
            //    hide: false
            //};
            //var width = this.gridOptionsWrapper.getColWidth();
            //var column = new Column(colDef, width, field);
            //return column;
        }

        private getWithOfColsInList(columnList: Column[]) {
            var result = 0;
            for (var i = 0; i<columnList.length; i++) {
                result += columnList[i].getActualWidth();
            }
            return result;
        }
    }

}